import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nomnom', {
  // ── Event listeners ──────────────────────────────
  onIndexingProgress: (
    cb: (data: {
      filePath: string;
      chunksProcessed: number;
      chunksTotal: number;
      phase: string;
      queueLength?: number;
    }) => void,
  ) => ipcRenderer.on('indexing:progress', (_e, data) => cb(data)),

  onIndexingComplete: (cb: (data: { filePath: string; chunkCount: number }) => void) =>
    ipcRenderer.on('indexing:complete', (_e, data) => cb(data)),

  onIndexingError: (cb: (data: { filePath: string; error: string }) => void) =>
    ipcRenderer.on('indexing:error', (_e, data) => cb(data)),

  onIndexingDeleted: (cb: (data: { filePath: string }) => void) =>
    ipcRenderer.on('indexing:deleted', (_e, data) => cb(data)),

  onModelReady: (cb: () => void) =>
    ipcRenderer.on('model:ready', () => cb()),

  onConfig: (cb: (config: { dropFolder: string; mcpPort: number | null; chatConfigured: boolean }) => void) =>
    ipcRenderer.on('config', (_e, config) => cb(config)),

  // ── Actions ──────────────────────────────────────
  openDropFolder: (folderPath: string) =>
    ipcRenderer.send('open-drop-folder', folderPath),

  openExternalUrl: (url: string) =>
    ipcRenderer.send('open-external-url', url),

  openFile: (filePath: string) =>
    ipcRenderer.send('open-file', filePath),

  // ── Data requests ────────────────────────────────
  getDocuments: (): Promise<
    Array<{
      relativePath: string;
      fileSize: number;
      fileType: string;
      indexedAt: number;
      folderId: string;
      absolutePath: string;
      chunkCount: number;
    }>
  > => ipcRenderer.invoke('get-documents'),

  getStats: (): Promise<{ fileCount: number; chunkCount: number }> =>
    ipcRenderer.invoke('get-stats'),

  registerMcpClient: (
    client: string,
  ): Promise<{ client: string; registered: boolean; configPath: string }> =>
    ipcRenderer.invoke('register-mcp-client', client),

  // ── Chat ────────────────────────────────────────
  chatInit: (): Promise<{ ready: boolean }> =>
    ipcRenderer.invoke('chat:init'),

  chatSend: (message: string): Promise<string> =>
    ipcRenderer.invoke('chat:send', message),

  onChatChunk: (cb: (chunk: string) => void) =>
    ipcRenderer.on('chat:chunk', (_e, chunk) => cb(chunk)),

  chatReset: (): Promise<void> =>
    ipcRenderer.invoke('chat:reset'),

  // ── Updates ─────────────────────────────────────
  onUpdateAvailable: (cb: (info: { version: string }) => void) =>
    ipcRenderer.on('update:available', (_e, info) => cb(info)),

  onUpdateDownloaded: (cb: () => void) =>
    ipcRenderer.on('update:downloaded', () => cb()),

  installUpdate: () => ipcRenderer.send('update:install'),
});
