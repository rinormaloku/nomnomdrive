import BetterSqlite3 from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { type SearchResult, type FolderRecord, type DocumentRecord } from '@nomnomdrive/shared';
import { DEFAULT_EMBED_DIMS } from '@nomnomdrive/shared';
import type { AppConfig } from './config';
import { getDbPath } from './config';

export function hashString(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
}

export function makeDocId(folderId: string, relativePath: string): string {
  return hashString(folderId + ':' + relativePath);
}

/**
 * Content-addressed chunk ID: hash of the chunk text.
 * Same text in two different documents → same chunk_id → stored once.
 */
export function makeChunkId(text: string): string {
  return hashString(text);
}

type Db = InstanceType<typeof BetterSqlite3>;

interface ChunkRow {
  chunk_id: string;
  content: string;
  doc_id: string;
  chunk_index: number;
  relative_path: string;
  file_type: string;
  distance: number;
}

interface CountRow { cnt: number }
interface IdRow    { id: number | bigint }
interface HashRow  { content_hash: string }
interface ChunkIdRow { chunk_id: string }

export class Store {
  private db!: Db;
  private dbPath: string;

  constructor(_config: AppConfig) {
    this.dbPath = getDbPath();
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    await fs.mkdir(dir, { recursive: true });

    this.db = new BetterSqlite3(this.dbPath);
    sqliteVec.load(this.db);

    // WAL mode: better read concurrency, no journal file bloat
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.runMigrations();
  }

  private runMigrations(): void {
    // ── Detect and clean up old libsql schema ──────────────────────────────
    // The old schema stored embeddings as F32_BLOB inside `chunks` and used
    // an HNSW shadow table (chunks_vec_idx_shadow) that grew to ~157 KB/chunk.
    // Drop everything so the indexer re-indexes cleanly with the new schema.
    const hasOldEmbeddingCol = (this.db
      .prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('chunks') WHERE name='embedding'")
      .get() as CountRow | undefined)?.cnt ?? 0;

    if (hasOldEmbeddingCol > 0) {
      console.log('[Store] Migrating from old libsql schema — chunks will be re-indexed');
      this.db.exec(`
        DROP INDEX  IF EXISTS chunks_vec_idx;
        DROP INDEX  IF EXISTS chunks_doc_idx;
        DROP TABLE  IF EXISTS chunks;
        DROP TABLE  IF EXISTS chunks_vec_idx_shadow;
        DROP TABLE  IF EXISTS libsql_vector_meta_shadow;
      `);
    }

    // ── Base tables ────────────────────────────────────────────────────────
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS folders (
        folder_id    TEXT PRIMARY KEY,
        path         TEXT NOT NULL,
        glob_pattern TEXT DEFAULT '**/*',
        created_at   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        doc_id        TEXT PRIMARY KEY,
        folder_id     TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        content_hash  TEXT NOT NULL,
        file_size     INTEGER,
        file_type     TEXT,
        indexed_at    INTEGER NOT NULL,
        FOREIGN KEY (folder_id) REFERENCES folders(folder_id)
      );

      -- Content-addressed: chunk_id = hash(text).
      -- Chunks are stored once even when shared across multiple documents.
      CREATE TABLE IF NOT EXISTS chunks (
        id             INTEGER PRIMARY KEY,
        chunk_id       TEXT UNIQUE NOT NULL,
        content        TEXT NOT NULL,
        local_version  INTEGER NOT NULL DEFAULT 1,
        synced_version INTEGER NOT NULL DEFAULT 0
      );

      -- Many-to-many join: which document uses which chunk at what position.
      -- Enables reference-counting for safe cascade deletes and deduplication.
      CREATE TABLE IF NOT EXISTS doc_chunks (
        doc_id      TEXT    NOT NULL,
        chunk_id    TEXT    NOT NULL,
        chunk_index INTEGER NOT NULL,
        PRIMARY KEY (doc_id, chunk_index),
        FOREIGN KEY (doc_id)   REFERENCES documents(doc_id),
        FOREIGN KEY (chunk_id) REFERENCES chunks(chunk_id)
      );

      CREATE INDEX IF NOT EXISTS doc_chunks_chunk_idx ON doc_chunks(chunk_id);

      CREATE TABLE IF NOT EXISTS sync_queue (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id    TEXT    NOT NULL,
        action    TEXT    NOT NULL,
        queued_at INTEGER NOT NULL,
        pushed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS sync_queue_pending ON sync_queue(pushed_at)
        WHERE pushed_at IS NULL;
    `);

    // ── sqlite-vec virtual table ───────────────────────────────────────────
    // vec_chunks is a brute-force KNN index (no HNSW graph, no shadow tables).
    // Its rowid matches chunks.id for O(1) joins.
    // Storage: exactly dims × 4 bytes per vector — no per-node overhead.
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks
       USING vec0(embedding float[${DEFAULT_EMBED_DIMS}])`,
    );
  }

  // ─── Meta ──────────────────────────────────────────────────────────────────

  async getMeta(key: string): Promise<string | null> {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.db
      .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run(key, value);
  }

  // ─── Folders ───────────────────────────────────────────────────────────────

  async upsertFolder(folderPath: string, globPattern = '**/*'): Promise<string> {
    const folderId = hashString(folderPath);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO folders (folder_id, path, glob_pattern, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(folderId, folderPath, globPattern, Date.now());
    return folderId;
  }

  async removeFolder(folderPath: string): Promise<void> {
    const folderId = hashString(folderPath);
    const docs = this.db
      .prepare('SELECT doc_id FROM documents WHERE folder_id = ?')
      .all(folderId) as Array<{ doc_id: string }>;
    for (const row of docs) {
      await this.removeDocument(row.doc_id);
    }
    this.db.prepare('DELETE FROM folders WHERE folder_id = ?').run(folderId);
  }

  async listFolders(): Promise<Array<FolderRecord & { docCount: number; chunkCount: number }>> {
    const rows = this.db.prepare(`
      SELECT
        f.folder_id, f.path, f.glob_pattern, f.created_at,
        COUNT(DISTINCT d.doc_id)   AS doc_count,
        COUNT(DISTINCT dc.chunk_id) AS chunk_count
      FROM folders f
      LEFT JOIN documents  d  ON d.folder_id  = f.folder_id
      LEFT JOIN doc_chunks dc ON dc.doc_id    = d.doc_id
      GROUP BY f.folder_id
      ORDER BY f.created_at ASC
    `).all() as Array<{
      folder_id: string; path: string; glob_pattern: string;
      created_at: number; doc_count: number; chunk_count: number;
    }>;
    return rows.map((r) => ({
      folderId:    r.folder_id,
      path:        r.path,
      globPattern: r.glob_pattern,
      createdAt:   r.created_at,
      docCount:    r.doc_count,
      chunkCount:  r.chunk_count,
    }));
  }

  // ─── Documents ─────────────────────────────────────────────────────────────

  async getDocumentHash(docId: string): Promise<string | null> {
    const row = this.db
      .prepare('SELECT content_hash FROM documents WHERE doc_id = ?')
      .get(docId) as HashRow | undefined;
    return row?.content_hash ?? null;
  }

  /**
   * Returns which of the given chunk IDs are already stored in the DB.
   * The indexer uses this to skip re-embedding chunks whose text is unchanged.
   */
  getExistingChunkIds(chunkIds: string[]): Set<string> {
    if (chunkIds.length === 0) return new Set();
    const placeholders = chunkIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT chunk_id FROM chunks WHERE chunk_id IN (${placeholders})`)
      .all(...chunkIds) as ChunkIdRow[];
    return new Set(rows.map((r) => r.chunk_id));
  }

  /**
   * Upserts a document and its chunks with smart diffing:
   *  - Chunks whose text (→ chunk_id) is unchanged are reused — no re-embedding,
   *    no churn in the vec_chunks index.
   *  - New chunks are inserted into both `chunks` and `vec_chunks`.
   *  - Chunks no longer referenced by this document are unlinked, then deleted
   *    from `chunks` and `vec_chunks` only if no other document still uses them.
   *
   * `embedding: null` means the caller confirmed the chunk already exists in DB.
   */
  async upsertDocument(doc: {
    docId: string;
    folderId: string;
    relativePath: string;
    contentHash: string;
    fileSize: number;
    fileType: string;
    chunks: Array<{ chunkId: string; text: string; embedding: number[] | null }>;
  }): Promise<void> {
    // Chunk IDs currently linked to this document (before update)
    const oldLinks = this.db
      .prepare('SELECT chunk_id FROM doc_chunks WHERE doc_id = ?')
      .all(doc.docId) as ChunkIdRow[];
    const oldChunkIds = new Set(oldLinks.map((r) => r.chunk_id));
    const newChunkIds = new Set(doc.chunks.map((c) => c.chunkId));
    const orphanCandidates = [...oldChunkIds].filter((id) => !newChunkIds.has(id));

    const stmtUpsertDoc     = this.db.prepare(`
      INSERT OR REPLACE INTO documents
        (doc_id, folder_id, relative_path, content_hash, file_size, file_type, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const stmtDeleteLinks   = this.db.prepare('DELETE FROM doc_chunks WHERE doc_id = ?');
    const stmtInsertChunk   = this.db.prepare(
      'INSERT OR IGNORE INTO chunks (chunk_id, content) VALUES (?, ?)');
    const stmtGetChunkRowid = this.db.prepare(
      'SELECT id FROM chunks WHERE chunk_id = ?');
    const stmtInsertVec     = this.db.prepare(
      'INSERT OR IGNORE INTO vec_chunks (rowid, embedding) VALUES (?, ?)');
    const stmtInsertLink    = this.db.prepare(
      'INSERT INTO doc_chunks (doc_id, chunk_id, chunk_index) VALUES (?, ?, ?)');

    const runUpsert = this.db.transaction(() => {
      stmtUpsertDoc.run(
        doc.docId, doc.folderId, doc.relativePath,
        doc.contentHash, doc.fileSize, doc.fileType, Date.now(),
      );
      stmtDeleteLinks.run(doc.docId);

      for (let i = 0; i < doc.chunks.length; i++) {
        const chunk = doc.chunks[i];
        if (chunk.embedding !== null) {
          // New chunk: insert into chunks table, then into vec_chunks.
          // vec_chunks rowid MUST be bound as SQLITE_INTEGER — BigInt ensures
          // better-sqlite3 doesn't coerce it to SQLITE_FLOAT.
          stmtInsertChunk.run(chunk.chunkId, chunk.text);
          const row = stmtGetChunkRowid.get(chunk.chunkId) as IdRow;
          stmtInsertVec.run(
            BigInt(row.id),
            new Float32Array(chunk.embedding),
          );
        }
        // (Re-)establish the doc → chunk link
        stmtInsertLink.run(doc.docId, chunk.chunkId, i);
      }
    });

    runUpsert();

    // After the transaction, delete orphan chunks (reference count dropped to 0)
    if (orphanCandidates.length > 0) {
      this.deleteOrphanChunks(orphanCandidates);
    }
  }

  /**
   * Removes a document and deletes any chunks that are now unreferenced.
   */
  async removeDocument(docId: string): Promise<void> {
    const links = this.db
      .prepare('SELECT chunk_id FROM doc_chunks WHERE doc_id = ?')
      .all(docId) as ChunkIdRow[];
    const chunkIds = links.map((r) => r.chunk_id);

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM doc_chunks WHERE doc_id = ?').run(docId);
      this.db.prepare('DELETE FROM documents  WHERE doc_id = ?').run(docId);
    })();

    if (chunkIds.length > 0) {
      this.deleteOrphanChunks(chunkIds);
    }
  }

  /**
   * Deletes chunks with zero remaining document references from both
   * `chunks` (content) and `vec_chunks` (embedding index).
   */
  private deleteOrphanChunks(chunkIds: string[]): void {
    const stmtCount     = this.db.prepare(
      'SELECT COUNT(*) AS cnt FROM doc_chunks WHERE chunk_id = ?');
    const stmtGetId     = this.db.prepare(
      'SELECT id FROM chunks WHERE chunk_id = ?');
    const stmtDelChunk  = this.db.prepare('DELETE FROM chunks     WHERE chunk_id = ?');
    const stmtDelVec    = this.db.prepare('DELETE FROM vec_chunks WHERE rowid     = ?');

    const cleanup = this.db.transaction(() => {
      for (const chunkId of chunkIds) {
        const { cnt } = stmtCount.get(chunkId) as CountRow;
        if (cnt === 0) {
          const row = stmtGetId.get(chunkId) as IdRow | undefined;
          if (row) stmtDelVec.run(BigInt(row.id));
          stmtDelChunk.run(chunkId);
        }
      }
    });
    cleanup();
  }

  async getDocumentText(filename: string): Promise<string | null> {
    const rows = this.db.prepare(`
      SELECT c.content
      FROM   doc_chunks dc
      JOIN   chunks     c  ON c.chunk_id = dc.chunk_id
      JOIN   documents  d  ON d.doc_id   = dc.doc_id
      WHERE  d.relative_path LIKE ?
      ORDER  BY dc.chunk_index ASC
    `).all(`%${filename}%`) as Array<{ content: string }>;
    if (rows.length === 0) return null;
    return rows.map((r) => r.content).join('\n\n');
  }

  async getAllDocuments(): Promise<(DocumentRecord & { chunkCount: number })[]> {
    const rows = this.db.prepare(`
      SELECT d.doc_id, d.folder_id, d.relative_path, d.content_hash,
             d.file_size, d.file_type, d.indexed_at,
             COUNT(dc.chunk_id) AS chunk_count
      FROM documents d
      LEFT JOIN doc_chunks dc ON dc.doc_id = d.doc_id
      GROUP BY d.doc_id
    `).all() as Array<{
      doc_id: string; folder_id: string; relative_path: string;
      content_hash: string; file_size: number; file_type: string;
      indexed_at: number; chunk_count: number;
    }>;
    return rows.map((r) => ({
      docId:        r.doc_id,
      folderId:     r.folder_id,
      relativePath: r.relative_path,
      contentHash:  r.content_hash,
      fileSize:     r.file_size,
      fileType:     r.file_type,
      indexedAt:    r.indexed_at,
      chunkCount:   r.chunk_count,
    }));
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  /**
   * Exact KNN search via sqlite-vec's brute-force vec0 index.
   *
   * sqlite-vec scans raw float32 blobs in C with SIMD — no HNSW graph,
   * no shadow table, 100% recall. At 290K chunks (100 books) this takes ~2 ms.
   *
   * Filtering by folder/fileType is done post-scan in JS because vec0 is a
   * virtual table that doesn't compose naturally with WHERE on joined columns.
   * We oversample (10×) when filters are active to ensure enough results survive.
   */
  async searchSimilar(
    queryVector: number[],
    limit = 5,
    filters: { folder?: string; fileType?: string } = {},
  ): Promise<SearchResult[]> {
    const hasFilters = !!(filters.folder || filters.fileType);
    const oversample = limit * (hasFilters ? 10 : 3);

    let rows: ChunkRow[];
    try {
      // sqlite-vec requires LIMIT to be a literal constraint directly on the
      // vec0 virtual table — it cannot be a bound parameter on an outer query
      // with JOINs. Use a subquery so the LIMIT sits on vec_chunks in isolation,
      // then join the metadata tables against the pre-filtered rowids.
      rows = this.db.prepare(`
        SELECT
          c.chunk_id,
          c.content,
          dc.doc_id,
          dc.chunk_index,
          d.relative_path,
          d.file_type,
          knn.distance
        FROM (
          SELECT rowid, distance
          FROM vec_chunks
          WHERE embedding MATCH ?
          LIMIT ?
        ) knn
        JOIN chunks     c  ON c.id        = knn.rowid
        JOIN doc_chunks dc ON dc.chunk_id  = c.chunk_id
        JOIN documents  d  ON d.doc_id    = dc.doc_id
        ORDER BY knn.distance ASC
      `).all(new Float32Array(queryVector), oversample) as ChunkRow[];
    } catch (err) {
      console.warn('[Store] vec_chunks search failed, falling back to text scan:', err);
      return this.fallbackTextSearch(limit);
    }

    // Filter, deduplicate by chunk_id (same chunk may link to multiple docs;
    // we already got the closest doc via dc join but dedup is still needed
    // if the same chunk appears multiple times due to multi-doc links).
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    const normalizedFileType = filters.fileType?.replace(/^\./, '');

    for (const row of rows) {
      if (seen.has(row.chunk_id)) continue;
      if (filters.folder      && !row.relative_path.includes(filters.folder)) continue;
      if (normalizedFileType  && row.file_type !== normalizedFileType)         continue;

      seen.add(row.chunk_id);
      results.push({
        chunkId:    row.chunk_id,
        docId:      row.doc_id,
        filename:   row.relative_path,
        content:    row.content,
        score:      1 - row.distance, // cosine distance → similarity
        chunkIndex: row.chunk_index,
        fileType:   row.file_type,
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  private fallbackTextSearch(limit: number): SearchResult[] {
    const rows = this.db.prepare(`
      SELECT c.chunk_id, dc.doc_id, dc.chunk_index, c.content,
             d.relative_path, d.file_type
      FROM doc_chunks dc
      JOIN chunks     c  ON c.chunk_id = dc.chunk_id
      JOIN documents  d  ON d.doc_id   = dc.doc_id
      LIMIT ?
    `).all(limit) as Array<{
      chunk_id: string; doc_id: string; chunk_index: number;
      content: string; relative_path: string; file_type: string;
    }>;
    return rows.map((r) => ({
      chunkId:    r.chunk_id,
      docId:      r.doc_id,
      filename:   r.relative_path,
      content:    r.content,
      score:      0,
      chunkIndex: r.chunk_index,
      fileType:   r.file_type,
    }));
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  async getStats(): Promise<{ fileCount: number; chunkCount: number }> {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*)               FROM documents)  AS file_count,
        (SELECT COUNT(DISTINCT chunk_id) FROM doc_chunks) AS chunk_count
    `).get() as { file_count: number; chunk_count: number };
    return {
      fileCount:  row.file_count,
      chunkCount: row.chunk_count,
    };
  }

  close(): void {
    this.db.close();
  }
}
