export type Document = {
  relativePath: string;
  fileSize: number;
  fileType: string;
  indexedAt: number;
  folderId: string;
  absolutePath: string;
  chunkCount: number;
  _syncing?: boolean;
  _error?: boolean;
};

export type Config = {
  dropFolder: string;
  mcpPort: number | null;
  chatConfigured: boolean;
};

export type Stats = {
  fileCount: number;
  chunkCount: number;
};

export type SyncProgress = {
  filePath: string;
  phase: string;
  chunksProcessed: number;
  chunksTotal: number;
  queueLength: number;
};

export type ProcessedFile = {
  name: string;
  path: string;
  time: number;
};
