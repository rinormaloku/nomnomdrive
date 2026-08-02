import BetterSqlite3 from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { type SearchResult, type FolderRecord, type DocumentRecord } from '@nomnomdrive/shared';
import { DEFAULT_EMBED_DIMS, RRF_K, SEARCH_MIN_SCORE } from '@nomnomdrive/shared';
import type { AppConfig } from './config';
import { getDbPath } from './config';
import type { DocMatcher } from './doc-filter';

export function hashString(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
}

export function makeDocId(folderId: string, relativePath: string): string {
  return hashString(folderId + ':' + relativePath);
}

/**
 * Stable identifier for a chunk, scoped to its position in its document.
 *
 * Text alone is not enough: `chunk_id` is UNIQUE, and chunk text is no longer
 * salted with per-file metadata, so two identical chunks (repeated boilerplate,
 * near-empty lines, similar CSV rows) would collide and abort the insert for
 * the whole document.
 */
export function makeChunkId(docId: string, chunkIndex: number, text: string): string {
  return hashString(`${docId}:${chunkIndex}:${text}`);
}

/**
 * Bumped whenever indexed content or vectors become incomparable with what an
 * older build wrote. On a mismatch the index is dropped and every watched file
 * is re-indexed on the next scan.
 *
 * 2 — chunk text no longer carries a `<metadata>` header (it flattened the
 *     embedding space), chunk size dropped 1500 → 500, and a keyword index was
 *     added alongside the vectors.
 */
const INDEX_SCHEMA_VERSION = 2;

/**
 * Converts a vec0 L2 distance into a cosine similarity in [-1, 1].
 *
 * `vec_chunks` uses sqlite-vec's default L2 metric. For unit vectors
 * ‖a-b‖² = 2 - 2·cos(a,b), so cos = 1 - d²/2. The embedders guarantee unit
 * vectors (see `truncateAndNormalize`). Clamped because float32 rounding can
 * push an exact self-match a hair past the ends of the range.
 */
export function cosineScoreFromL2(distance: number): number {
  return Math.max(-1, Math.min(1, 1 - (distance * distance) / 2));
}

/** What a caller needs to identify and act on a document. Never exposes a full path. */
export interface DocumentSummary {
  docId: string;
  /** Bare file name — the handle callers pass back to read_document. */
  filename: string;
  /** "FolderName/relative/path.ext" — filtered against, shown only to disambiguate. */
  matchPath: string;
  fileType: string;
  fileSize: number;
  chunkCount: number;
  indexedAt: number;
}

/**
 * The path filters run against: the watch folder's own name plus the path
 * inside it. Including the folder name is what lets a single `filter` scope a
 * search to one folder without a separate parameter.
 */
export function makeMatchPath(folderPath: string, relativePath: string): string {
  return `${path.basename(folderPath)}/${relativePath}`.replace(/\\/g, '/');
}

/**
 * Words too common to narrow anything. Dropping them keeps an OR-query from
 * matching most of the corpus; BM25 would rank them low anyway, but not before
 * paying to scan the rows.
 */
const FTS_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'with',
  'what', 'which', 'how', 'was', 'were', 'are', 'be', 'that', 'this', 'from', 'by',
  'der', 'die', 'das', 'und', 'oder', 'von', 'zu', 'ist', 'ein', 'eine', 'für',
]);

/**
 * Builds an FTS5 MATCH expression from free text.
 *
 * The raw query can never be passed through: FTS5 treats `-`, `*`, `:`, `"` and
 * `NEAR` as operators and raises a syntax error on anything malformed. So we
 * extract word tokens, quote each one, and OR them — matching more documents
 * than an AND would, which is correct here because BM25 ranking (not matching)
 * decides what actually surfaces.
 */
export function toFtsQuery(text: string): string | null {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
  const useful = tokens
    .filter((t) => t.length >= 2 && !FTS_STOPWORDS.has(t))
    .slice(0, 12);
  if (useful.length === 0) return null;
  // Trailing * is a prefix match: "invoic" also hits "invoices".
  return useful.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
}

type Db = InstanceType<typeof BetterSqlite3>;

/** Columns every retriever selects, so vector and keyword hits merge cleanly. */
interface ChunkRow {
  chunk_id: string;
  content: string;
  doc_id: string;
  chunk_index: number;
  relative_path: string;
  file_type: string;
  chunk_count: number;
  folder_path: string;
}

interface VectorChunkRow extends ChunkRow {
  distance: number;
}

/** Chunk indexes are stored 0-based and reported 1-based — agents count from 1. */
function toSearchResult(row: ChunkRow): SearchResult {
  return {
    chunkId:     row.chunk_id,
    docId:       row.doc_id,
    filename:    path.basename(row.relative_path),
    content:     row.content,
    score:       0,
    chunkIndex:  row.chunk_index + 1,
    fileType:    row.file_type,
    totalChunks: row.chunk_count,
    matchPath:   makeMatchPath(row.folder_path, row.relative_path),
  };
}

/**
 * Reciprocal Rank Fusion: score a chunk by 1/(k + rank) in each result list and
 * sum. Uses only rank, so a cosine similarity and a BM25 score — which live on
 * incomparable scales — can be combined without calibrating either. A chunk
 * found by both retrievers outranks one found by only a single retriever, which
 * is the behaviour we want.
 */
function fuseByRank(
  vectorHits: SearchResult[],
  keywordHits: SearchResult[],
  limit: number,
): SearchResult[] {
  const best = new Map<string, SearchResult>();
  const fused = new Map<string, number>();

  for (const hits of [vectorHits, keywordHits]) {
    hits.forEach((hit, rank) => {
      const existing = best.get(hit.chunkId);
      // Prefer the copy carrying a real cosine score; keyword hits have none.
      if (!existing || (existing.score === 0 && hit.score > 0)) best.set(hit.chunkId, hit);
      fused.set(hit.chunkId, (fused.get(hit.chunkId) ?? 0) + 1 / (RRF_K + rank + 1));
    });
  }

  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([chunkId]) => best.get(chunkId)!);
}

interface CountRow { cnt: number }
interface IdRow    { id: number | bigint }
interface HashRow  { content_hash: string }

export class Store {
  private db!: Db;
  private dbPath: string;
  /** False when the bundled SQLite lacks FTS5 — search degrades to vector-only. */
  private ftsEnabled = false;

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

    // sqlite-vec ships pre-built native extensions (.so/.dylib/.dll).
    // Inside an Electron asar, dlopen can't read from the virtual filesystem,
    // so we resolve the path through app.asar.unpacked where electron-builder
    // extracts the files (see asarUnpack in electron-builder.config.js).
    let vecPath = sqliteVec.getLoadablePath();
    if (vecPath.includes('app.asar')) {
      vecPath = vecPath.replace('app.asar', 'app.asar.unpacked');
    }
    this.db.loadExtension(vecPath);

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
        chunk_count   INTEGER NOT NULL DEFAULT 0,
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

      -- Range reads (read_document) and neighbour expansion around a search hit
      -- both scan a contiguous slice of one document.
      CREATE INDEX IF NOT EXISTS chunks_doc_pos_idx ON chunks(doc_id, chunk_index);

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

    // Older DBs predate chunk_count.
    const hasChunkCount = (this.db
      .prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('documents') WHERE name='chunk_count'")
      .get() as CountRow | undefined)?.cnt ?? 0;
    if (hasChunkCount === 0) {
      this.db.exec('ALTER TABLE documents ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0');
    }

    // ── sqlite-vec virtual table ───────────────────────────────────────────
    // vec_chunks is a brute-force KNN index (no HNSW graph, no shadow tables).
    // Its rowid matches chunks.id for O(1) joins.
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks
       USING vec0(embedding float[${DEFAULT_EMBED_DIMS}])`,
    );

    // ── FTS5 keyword index ─────────────────────────────────────────────────
    // Vectors alone miss exact tokens — invoice numbers, surnames, error codes,
    // file names. This is what replaced prepending a `<metadata>` header to
    // every chunk: the file name is a searchable *field* now, not text baked
    // into the embedding where it flattened the vector space.
    // rowid mirrors chunks.id; rows are maintained by hand on upsert/remove.
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
        USING fts5(content, filename, tokenize = 'unicode61 remove_diacritics 2')
      `);
      this.ftsEnabled = true;
    } catch (err) {
      console.warn('[Store] FTS5 unavailable — keyword search disabled:', err);
      this.ftsEnabled = false;
    }

    // ── Seed embed_dims for dim-change detection ───────────────────────────
    // Uses INSERT OR IGNORE so existing DBs keep their value once written.
    // Pre-existing installs without this key are assumed to use DEFAULT_EMBED_DIMS.
    this.db
      .prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('embed_dims', ?)")
      .run(String(DEFAULT_EMBED_DIMS));

    this.migrateToNormalizedVectors();
    this.migrateIndexSchemaVersion();
  }

  /**
   * Drops the index when it was built by a version whose chunking or embedded
   * text is no longer comparable with what this build produces. Mixing the two
   * silently degrades every search, so a full re-index is the only honest
   * option. Watched files are re-scanned on startup, which refills it.
   */
  private migrateIndexSchemaVersion(): void {
    const stored = Number(
      (this.db
        .prepare("SELECT value FROM meta WHERE key = 'index_schema_version'")
        .get() as { value: string } | undefined)?.value ?? 0,
    );
    if (stored === INDEX_SCHEMA_VERSION) return;

    const chunkCount = (this.db
      .prepare('SELECT COUNT(*) AS cnt FROM chunks')
      .get() as CountRow | undefined)?.cnt ?? 0;

    if (chunkCount > 0) {
      const dims = this.getStoredDims() ?? DEFAULT_EMBED_DIMS;
      console.log(
        `[Store] Index schema ${stored} → ${INDEX_SCHEMA_VERSION}: re-indexing ` +
        `${chunkCount} chunks (metadata removed from chunk text, smaller chunks).`,
      );
      this.db.exec(`
        DROP TABLE IF EXISTS vec_chunks;
        DELETE FROM chunks;
        DELETE FROM documents;
      `);
      this.db.exec(`CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[${dims}])`);
      if (this.ftsEnabled) this.db.exec('DELETE FROM chunks_fts');
    }

    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('index_schema_version', ?)")
      .run(String(INDEX_SCHEMA_VERSION));
  }

  /**
   * One-time migration: older builds wrote raw, unnormalized embeddings.
   * vec0 ranks by L2, so those magnitudes skewed the ranking and made the
   * reported score negative. Existing rows cannot be renormalized in place —
   * vec0 exposes no read-modify-write path — so drop and re-index.
   */
  private migrateToNormalizedVectors(): void {
    const done = (this.db
      .prepare("SELECT value FROM meta WHERE key = 'embed_normalized'")
      .get() as { value: string } | undefined)?.value === '1';
    if (done) return;

    const stored = (this.db
      .prepare('SELECT COUNT(*) AS cnt FROM vec_chunks')
      .get() as CountRow | undefined)?.cnt ?? 0;

    if (stored > 0) {
      const dims = this.getStoredDims() ?? DEFAULT_EMBED_DIMS;
      console.log(
        `[Store] Re-indexing ${stored} chunks: stored vectors are not L2-normalized.`,
      );
      this.db.exec(`
        DROP TABLE IF EXISTS vec_chunks;
        DELETE FROM chunks;
        DELETE FROM documents;
      `);
      this.db.exec(`CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[${dims}])`);
    }

    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('embed_normalized', '1')")
      .run();
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
    if (this.ftsEnabled) this.db.exec('DELETE FROM chunks_fts');
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
   * Upserts a document and its chunks, replacing any previous set.
   *
   * Chunk text is stored exactly as it was embedded — no `<metadata>` header.
   * Source identity (file name, type, position) lives in `documents` and the
   * FTS `filename` column, and is attached to results at query time.
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
    const fileName = path.basename(doc.relativePath);

    const stmtInsertChunk = this.db.prepare(
      'INSERT INTO chunks (chunk_id, doc_id, chunk_index, content) VALUES (?, ?, ?, ?)');
    const stmtInsertVec = this.db.prepare(
      'INSERT OR IGNORE INTO vec_chunks (rowid, embedding) VALUES (?, ?)');
    const stmtInsertFts = this.ftsEnabled
      ? this.db.prepare('INSERT INTO chunks_fts (rowid, content, filename) VALUES (?, ?, ?)')
      : null;

    this.db.transaction(() => {
      this.deleteChunkRows(doc.docId);

      this.db.prepare(`
        INSERT OR REPLACE INTO documents
          (doc_id, folder_id, relative_path, content_hash, file_size, file_type,
           indexed_at, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        doc.docId, doc.folderId, doc.relativePath,
        doc.contentHash, doc.fileSize, doc.fileType, Date.now(), doc.chunks.length,
      );

      for (let i = 0; i < doc.chunks.length; i++) {
        const chunk = doc.chunks[i];
        // better-sqlite3 returns the new rowid directly — no follow-up SELECT.
        const rowid = BigInt(stmtInsertChunk.run(chunk.chunkId, doc.docId, i, chunk.text)
          .lastInsertRowid);
        stmtInsertVec.run(rowid, new Float32Array(chunk.embedding));
        stmtInsertFts?.run(rowid, chunk.text, fileName);
      }
    })();
  }

  async removeDocument(docId: string): Promise<void> {
    this.db.transaction(() => {
      this.deleteChunkRows(docId);
      this.db.prepare('DELETE FROM documents WHERE doc_id = ?').run(docId);
    })();
  }

  /**
   * Removes a document's chunks from all three tables that reference them.
   * Vector and FTS rows are keyed by chunks.id, so they must go first.
   */
  private deleteChunkRows(docId: string): void {
    const oldIds = this.db
      .prepare('SELECT id FROM chunks WHERE doc_id = ?')
      .all(docId) as IdRow[];
    if (oldIds.length === 0) return;

    const stmtDeleteVec = this.db.prepare('DELETE FROM vec_chunks WHERE rowid = ?');
    const stmtDeleteFts = this.ftsEnabled
      ? this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?')
      : null;
    for (const { id } of oldIds) {
      stmtDeleteVec.run(BigInt(id));
      stmtDeleteFts?.run(BigInt(id));
    }
    this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId);
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

  /**
   * Every indexed document, narrowed by an optional filter.
   *
   * `matchPath` ("Work/2024/report.pdf") is what filters run against; callers
   * only ever display `filename`. Newest first — "what do I have" almost always
   * means "what did I add recently".
   */
  async listIndexedDocuments(matcher?: DocMatcher): Promise<DocumentSummary[]> {
    const rows = this.db.prepare(`
      SELECT d.doc_id, d.relative_path, d.file_type, d.file_size,
             d.chunk_count, d.indexed_at, f.path AS folder_path
      FROM documents d
      JOIN folders   f ON f.folder_id = d.folder_id
      ORDER BY d.indexed_at DESC
    `).all() as Array<{
      doc_id: string; relative_path: string; file_type: string; file_size: number;
      chunk_count: number; indexed_at: number; folder_path: string;
    }>;

    const docs = rows.map((r) => ({
      docId:       r.doc_id,
      filename:    path.basename(r.relative_path),
      matchPath:   makeMatchPath(r.folder_path, r.relative_path),
      fileType:    r.file_type,
      fileSize:    r.file_size,
      chunkCount:  r.chunk_count,
      indexedAt:   r.indexed_at,
    }));
    return matcher ? docs.filter((d) => matcher(d.matchPath)) : docs;
  }

  /**
   * Documents whose name the caller could have meant.
   *
   * Exact name matches win outright; otherwise anything whose qualified path
   * contains the fragment is a candidate. Returning all of them lets the caller
   * disambiguate instead of silently reading the wrong file.
   */
  async resolveDocuments(file: string): Promise<DocumentSummary[]> {
    const needle = file.trim().toLowerCase();
    if (!needle) return [];

    const all = await this.listIndexedDocuments();
    const exact = all.filter((d) => d.filename.toLowerCase() === needle);
    if (exact.length > 0) return exact;

    // Tolerate a path being passed where a name was expected.
    const normalized = needle.replace(/\\/g, '/');
    return all.filter(
      (d) =>
        d.matchPath.toLowerCase().includes(normalized) ||
        d.filename.toLowerCase().includes(normalized),
    );
  }

  /**
   * Chunks `from`..`to` (1-based, inclusive) of one document, in order.
   * The range is clamped to what exists rather than rejected — an agent
   * guessing a range slightly past the end should get content, not an error.
   */
  async getChunkRange(
    docId: string,
    from: number,
    to: number,
  ): Promise<Array<{ chunkIndex: number; content: string }>> {
    const rows = this.db.prepare(`
      SELECT chunk_index, content
      FROM   chunks
      WHERE  doc_id = ? AND chunk_index >= ? AND chunk_index <= ?
      ORDER  BY chunk_index ASC
    `).all(docId, from - 1, to - 1) as Array<{ chunk_index: number; content: string }>;

    return rows.map((r) => ({ chunkIndex: r.chunk_index + 1, content: r.content }));
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
   * Hybrid retrieval: dense vectors fused with FTS5 keyword hits.
   *
   * Neither retriever is sufficient alone. Vectors handle paraphrase but miss
   * exact tokens — an invoice number, a surname, a file name. Keyword search
   * nails those and is blind to synonyms. Fusing them is also what let the
   * indexer stop prepending a `<metadata>` header to every chunk: file names
   * are findable through the FTS `filename` column instead of being smeared
   * into every embedding.
   *
   * Results are merged with Reciprocal Rank Fusion, which needs no score
   * calibration between the two — only rank order, which is all BM25 and
   * cosine agree on.
   */
  async searchHybrid(
    queryVector: number[],
    queryText: string,
    limit: number,
    matcher?: DocMatcher,
  ): Promise<SearchResult[]> {
    const vectorHits = this.searchVector(queryVector, limit, matcher);
    const keywordHits = this.searchKeyword(queryText, limit, matcher);
    return fuseByRank(vectorHits, keywordHits, limit);
  }

  /**
   * Exact KNN via sqlite-vec's brute-force vec0 index — raw float32 scanned in
   * C with SIMD, no HNSW graph, 100% recall. ~2 ms at 290K chunks.
   *
   * The filter is applied in JS because vec0 is a virtual table that does not
   * compose with WHERE on joined columns. A selective filter can therefore eat
   * the whole candidate set, so we widen k and retry instead of quietly
   * returning two results when fifty matched.
   */
  private searchVector(
    queryVector: number[],
    limit: number,
    matcher?: DocMatcher,
  ): SearchResult[] {
    const totalChunks = (this.db
      .prepare('SELECT COUNT(*) AS cnt FROM chunks')
      .get() as CountRow | undefined)?.cnt ?? 0;
    if (totalChunks === 0) return [];

    const query = this.db.prepare(`
      SELECT
        c.chunk_id, c.content, c.doc_id, c.chunk_index,
        d.relative_path, d.file_type, d.chunk_count,
        f.path AS folder_path,
        knn.distance
      FROM (
        SELECT rowid, distance
        FROM vec_chunks
        WHERE embedding MATCH ?
        LIMIT ?
      ) knn
      JOIN chunks    c ON c.id        = knn.rowid
      JOIN documents d ON d.doc_id    = c.doc_id
      JOIN folders   f ON f.folder_id = d.folder_id
      ORDER BY knn.distance ASC
    `);

    const vector = new Float32Array(queryVector);
    let k = Math.min(limit * 3, totalChunks);

    for (let attempt = 0; attempt < 3; attempt++) {
      let rows: VectorChunkRow[];
      try {
        rows = query.all(vector, k) as VectorChunkRow[];
      } catch (err) {
        console.warn('[Store] vector search failed:', err);
        return [];
      }

      const hits = rows
        .map((row) => ({ ...toSearchResult(row), score: cosineScoreFromL2(row.distance) }))
        .filter((hit) => hit.score >= SEARCH_MIN_SCORE)
        .filter((hit) => !matcher || matcher(hit.matchPath));

      // Enough survived, or we have already scanned everything there is.
      if (hits.length >= limit || k >= totalChunks) return hits.slice(0, limit);
      k = Math.min(k * 4, totalChunks);
    }
    return [];
  }

  /** BM25-ranked keyword hits over chunk text and file name. */
  private searchKeyword(
    queryText: string,
    limit: number,
    matcher?: DocMatcher,
  ): SearchResult[] {
    if (!this.ftsEnabled) return [];
    const matchExpr = toFtsQuery(queryText);
    if (!matchExpr) return [];

    try {
      const rows = this.db.prepare(`
        SELECT
          c.chunk_id, c.content, c.doc_id, c.chunk_index,
          d.relative_path, d.file_type, d.chunk_count,
          f.path AS folder_path
        FROM chunks_fts
        JOIN chunks    c ON c.id        = chunks_fts.rowid
        JOIN documents d ON d.doc_id    = c.doc_id
        JOIN folders   f ON f.folder_id = d.folder_id
        WHERE chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts, 1.0, 2.0)
        LIMIT ?
      `).all(matchExpr, limit * 4) as ChunkRow[];

      return rows
        .map(toSearchResult)
        .filter((hit) => !matcher || matcher(hit.matchPath))
        .slice(0, limit);
    } catch (err) {
      console.warn('[Store] keyword search failed:', err);
      return [];
    }
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
