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
 * Used as a stable opaque identifier for search results.
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

export class Store {
  private db!: Db;
  private dbPath: string;

  constructor(_config: AppConfig) {
    this.dbPath = getDbPath();
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    await fs.mkdir(dir, { recursive: true });

    // If the main DB was deleted (e.g. rm local.db) but WAL/SHM files remain,
    // SQLite will error on open trying to recover pages from a non-existent DB.
    // Clean them up so we start fresh.
    const dbExists = await fs.access(this.dbPath).then(() => true).catch(() => false);
    if (!dbExists) {
      await fs.unlink(this.dbPath + '-wal').catch(() => {});
      await fs.unlink(this.dbPath + '-shm').catch(() => {});
    }

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

    // ── Detect and clean up doc_chunks schema ──────────────────────────────
    // The old schema had a separate doc_chunks join table for many-to-many
    // chunk ownership. The new schema stores doc_id and chunk_index directly
    // in chunks — each chunk is owned by exactly one document.
    const hasDocChunksTable = (this.db
      .prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='doc_chunks'")
      .get() as CountRow | undefined)?.cnt ?? 0;

    if (hasDocChunksTable > 0) {
      console.log('[Store] Migrating from doc_chunks schema — documents will be re-indexed');
      this.db.exec(`
        DROP INDEX  IF EXISTS doc_chunks_chunk_idx;
        DROP TABLE  IF EXISTS doc_chunks;
        DROP TABLE  IF EXISTS vec_chunks;
        DROP TABLE  IF EXISTS chunks;
        DELETE FROM documents;
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

      -- Each chunk is owned by exactly one document.
      -- chunk_id = hash(text) is a stable opaque identifier for search results.
      CREATE TABLE IF NOT EXISTS chunks (
        id             INTEGER PRIMARY KEY,
        chunk_id       TEXT UNIQUE NOT NULL,
        doc_id         TEXT NOT NULL,
        chunk_index    INTEGER NOT NULL,
        content        TEXT NOT NULL,
        local_version  INTEGER NOT NULL DEFAULT 1,
        synced_version INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (doc_id) REFERENCES documents(doc_id)
      );

      CREATE INDEX IF NOT EXISTS chunks_doc_idx ON chunks(doc_id);

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
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks
       USING vec0(embedding float[${DEFAULT_EMBED_DIMS}])`,
    );

    // ── Seed embed_dims for dim-change detection ───────────────────────────
    // Uses INSERT OR IGNORE so existing DBs keep their value once written.
    // Pre-existing installs without this key are assumed to use DEFAULT_EMBED_DIMS.
    this.db
      .prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('embed_dims', ?)")
      .run(String(DEFAULT_EMBED_DIMS));
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

  /**
   * Returns the embedding dimension stored in meta, or null if not yet set.
   * Synchronous so it can be called right after initialize() without awaiting.
   */
  getStoredDims(): number | null {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'embed_dims'")
      .get() as { value: string } | undefined;
    return row ? Number(row.value) : null;
  }

  /**
   * Drops and recreates the vec_chunks table for a new embedding dimension,
   * then clears documents and chunks so everything gets re-indexed.
   */
  resetForNewDims(newDims: number): void {
    const current = this.getStoredDims();
    console.log(
      `[Store] Embedding dims changed (${current ?? '?'} → ${newDims}). ` +
      'Resetting vector index — all files will be re-indexed.',
    );
    this.db.exec(`
      DROP TABLE IF EXISTS vec_chunks;
      DELETE FROM chunks;
      DELETE FROM documents;
    `);
    this.db.exec(
      `CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[${newDims}])`,
    );
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('embed_dims', ?)")
      .run(String(newDims));
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
        COUNT(DISTINCT d.doc_id) AS doc_count,
        COUNT(c.id)              AS chunk_count
      FROM folders f
      LEFT JOIN documents d ON d.folder_id = f.folder_id
      LEFT JOIN chunks    c ON c.doc_id    = d.doc_id
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

  async getDocumentIdByContentHash(contentHash: string): Promise<string | null> {
    const row = this.db
      .prepare('SELECT doc_id FROM documents WHERE content_hash = ? LIMIT 1')
      .get(contentHash) as { doc_id: string } | undefined;
    return row?.doc_id ?? null;
  }

  /**
   * Upserts a document and its chunks. Old chunks for this document are deleted
   * before the new set is inserted — no diffing needed since each chunk embeds
   * file-specific metadata (path, position) that makes cross-document reuse impossible.
   */
  async upsertDocument(doc: {
    docId: string;
    folderId: string;
    relativePath: string;
    contentHash: string;
    fileSize: number;
    fileType: string;
    chunks: Array<{ chunkId: string; text: string; embedding: number[] }>;
  }): Promise<void> {
    const stmtInsertChunk = this.db.prepare(
      'INSERT INTO chunks (chunk_id, doc_id, chunk_index, content) VALUES (?, ?, ?, ?)');
    const stmtGetChunkRowid = this.db.prepare(
      'SELECT id FROM chunks WHERE chunk_id = ?');
    const stmtInsertVec = this.db.prepare(
      'INSERT OR IGNORE INTO vec_chunks (rowid, embedding) VALUES (?, ?)');

    this.db.transaction(() => {
      // Delete old vectors before removing chunks (need rowids first)
      const oldIds = this.db
        .prepare('SELECT id FROM chunks WHERE doc_id = ?')
        .all(doc.docId) as IdRow[];
      for (const { id } of oldIds) {
        this.db.prepare('DELETE FROM vec_chunks WHERE rowid = ?').run(BigInt(id));
      }
      this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(doc.docId);

      this.db.prepare(`
        INSERT OR REPLACE INTO documents
          (doc_id, folder_id, relative_path, content_hash, file_size, file_type, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        doc.docId, doc.folderId, doc.relativePath,
        doc.contentHash, doc.fileSize, doc.fileType, Date.now(),
      );

      for (let i = 0; i < doc.chunks.length; i++) {
        const chunk = doc.chunks[i];
        stmtInsertChunk.run(chunk.chunkId, doc.docId, i, chunk.text);
        const row = stmtGetChunkRowid.get(chunk.chunkId) as IdRow;
        stmtInsertVec.run(BigInt(row.id), new Float32Array(chunk.embedding));
      }
    })();
  }

  async removeDocument(docId: string): Promise<void> {
    this.db.transaction(() => {
      const oldIds = this.db
        .prepare('SELECT id FROM chunks WHERE doc_id = ?')
        .all(docId) as IdRow[];
      for (const { id } of oldIds) {
        this.db.prepare('DELETE FROM vec_chunks WHERE rowid = ?').run(BigInt(id));
      }
      this.db.prepare('DELETE FROM chunks    WHERE doc_id = ?').run(docId);
      this.db.prepare('DELETE FROM documents WHERE doc_id = ?').run(docId);
    })();
  }

  /**
   * Purges DB records for files that no longer exist on disk.
   * Called once at startup to handle files deleted while the daemon was offline.
   * Returns the count of removed document records.
   */
  async reconcileWithFilesystem(): Promise<number> {
    const folders = await this.listFolders();
    const folderMap = new Map(folders.map((f) => [f.folderId, f.path]));

    const docs = this.db
      .prepare('SELECT doc_id, folder_id, relative_path FROM documents')
      .all() as Array<{ doc_id: string; folder_id: string; relative_path: string }>;

    let removed = 0;
    for (const doc of docs) {
      const folderPath = folderMap.get(doc.folder_id);
      if (!folderPath) {
        await this.removeDocument(doc.doc_id);
        removed++;
        continue;
      }
      const fullPath = path.join(folderPath, doc.relative_path);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat?.isFile()) {
        await this.removeDocument(doc.doc_id);
        removed++;
      }
    }
    return removed;
  }

  async getDocumentText(filename: string): Promise<string | null> {
    const rows = this.db.prepare(`
      SELECT c.content
      FROM   chunks    c
      JOIN   documents d ON d.doc_id = c.doc_id
      WHERE  d.relative_path LIKE ?
      ORDER  BY c.chunk_index ASC
    `).all(`%${filename}%`) as Array<{ content: string }>;
    if (rows.length === 0) return null;
    return rows.map((r) => r.content).join('\n\n');
  }

  async getAllDocuments(): Promise<(DocumentRecord & { chunkCount: number })[]> {
    const rows = this.db.prepare(`
      SELECT d.doc_id, d.folder_id, d.relative_path, d.content_hash,
             d.file_size, d.file_type, d.indexed_at,
             COUNT(c.id) AS chunk_count
      FROM documents d
      LEFT JOIN chunks c ON c.doc_id = d.doc_id
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
      rows = this.db.prepare(`
        SELECT
          c.chunk_id,
          c.content,
          c.doc_id,
          c.chunk_index,
          d.relative_path,
          d.file_type,
          knn.distance
        FROM (
          SELECT rowid, distance
          FROM vec_chunks
          WHERE embedding MATCH ?
          LIMIT ?
        ) knn
        JOIN chunks    c ON c.id     = knn.rowid
        JOIN documents d ON d.doc_id = c.doc_id
        ORDER BY knn.distance ASC
      `).all(new Float32Array(queryVector), oversample) as ChunkRow[];
    } catch (err) {
      console.warn('[Store] vec_chunks search failed, falling back to text scan:', err);
      return this.fallbackTextSearch(limit);
    }

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
        score:      1 - row.distance,
        chunkIndex: row.chunk_index,
        fileType:   row.file_type,
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  private fallbackTextSearch(limit: number): SearchResult[] {
    const rows = this.db.prepare(`
      SELECT c.chunk_id, c.doc_id, c.chunk_index, c.content,
             d.relative_path, d.file_type
      FROM chunks    c
      JOIN documents d ON d.doc_id = c.doc_id
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
        (SELECT COUNT(*) FROM documents) AS file_count,
        (SELECT COUNT(*) FROM chunks)    AS chunk_count
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
