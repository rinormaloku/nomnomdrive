export interface FolderRecord {
  folderId: string;
  path: string;
  globPattern: string;
  createdAt: number;
}

export interface DocumentRecord {
  docId: string;
  folderId: string;
  relativePath: string;
  contentHash: string;
  fileSize: number;
  fileType: string;
  indexedAt: number;
}

export interface ChunkRecord {
  chunkId: string;
  docId: string;
  chunkIndex: number;
  content: string;
  embedding?: number[];
  localVersion: number;
  syncedVersion: number;
}

/** A single chunk hit, as returned by the vector or keyword retriever. */
export interface SearchResult {
  chunkId: string;
  docId: string;
  /** Bare file name — callers address documents by name, never by path. */
  filename: string;
  content: string;
  /** Cosine similarity for vector hits; 0 for keyword-only hits. */
  score: number;
  chunkIndex: number;
  fileType: string;
  totalChunks: number;
  /** Folder-qualified path, kept internally for filtering and disambiguation. */
  matchPath: string;
}

/**
 * Adjacent chunk hits from one document, merged and padded with neighbours.
 * This is what search_documents actually reports — a bare 500-char chunk is
 * usually too small to answer from.
 */
export interface SearchPassage {
  docId: string;
  filename: string;
  fileType: string;
  /** 1-based, inclusive — the range to pass back to read_document. */
  fromChunk: number;
  toChunk: number;
  totalChunks: number;
  /** Best score among the hits merged into this passage. */
  score: number;
  content: string;
}

/** A resolved slice of one document's chunks. */
export interface ChunkRange {
  docId: string;
  filename: string;
  fileType: string;
  fromChunk: number;
  toChunk: number;
  totalChunks: number;
  content: string;
}

export interface IndexingProgress {
  filePath: string;
  chunksProcessed: number;
  chunksTotal: number;
  queueLength: number;
  phase: 'parsing' | 'chunking' | 'embedding' | 'storing';
  /** Files completed in the current indexing batch (resets when the queue drains). */
  filesDone: number;
  /** Total files enqueued in the current indexing batch. */
  filesTotal: number;
}

export interface FolderSummary {
  path: string;
  enabled: boolean;
  documentCount?: number;
  chunkCount?: number;
}

export interface IndexStats {
  documentCount: number;
  chunkCount: number;
  folderCount: number;
}

export interface DaemonStatus {
  pid: number;
  running: boolean;
  modelReady: boolean;
  /** @deprecated use indexedFiles */ indexedFiles?: number;
  /** @deprecated use indexedChunks */ indexedChunks?: number;
  queueSize: number;
  queueLength: number;
  currentFile?: string;
  model: string;
  mode: 'local' | 'cloud';
  mcpPort: number;
  watchedPaths: string[];
  folders?: FolderSummary[];
  stats?: IndexStats;
}

export interface IpcMessage {
  id?: string;
  command: string;
  payload?: unknown;
}

export interface IpcResponse<T = unknown> {
  id: string;
  success: boolean;
  /** Alias for success, set by the IPC client for ergonomic access */
  ok?: boolean;
  data?: T;
  error?: string;
}
