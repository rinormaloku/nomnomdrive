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

export interface SearchResult {
  chunkId: string;
  docId: string;
  filename: string;
  content: string;
  score: number;
  chunkIndex: number;
  fileType: string;
}

export interface IndexingProgress {
  filePath: string;
  chunksProcessed: number;
  chunksTotal: number;
  queueLength: number;
  phase: 'parsing' | 'chunking' | 'embedding' | 'storing';
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
