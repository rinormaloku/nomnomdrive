import { contextBridge, ipcRenderer, webUtils } from 'electron';

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

  onModelError: (cb: (data: { error: string }) => void) =>
    ipcRenderer.on('model:error', (_e, data) => cb(data)),

  onConfig: (cb: (config: { dropFolder: string; mcpPort: number | null; chatConfigured: boolean }) => void) =>
    ipcRenderer.on('config', (_e, config) => cb(config)),

  // ── Setup / Onboarding ───────────────────────────
  setupCheck: (): Promise<{
    needsSetup: boolean;
    needsModelDownload: boolean;
    existingConfig?: unknown;
    missingModels?: { embed: boolean; chat: boolean };
  }> => ipcRenderer.invoke('setup:check'),

  setupGetCatalog: (): Promise<{
    embedModels: Array<{ id: string; label: string; size: string; recommended: boolean }>;
    chatModels: Array<{ id: string; label: string; size: string; recommended: boolean }>;
    defaults: { watchPath: string; embedModelId: string; chatModelId: string; mcpPort: number };
  }> => ipcRenderer.invoke('setup:get-catalog'),

  setupStart: (options: {
    watchPath: string;
    embedModelId: string;
    embedConfig?: unknown;
    chatModelId: string;
    chatConfig?: unknown;
    mcpPort: number;
    gpuType?: string;
  }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('setup:start', options),

  onSetupProgress: (cb: (progress: {
    phase: string;
    modelId: string;
    modelLabel: string;
    downloaded: number;
    total: number;
  }) => void) => ipcRenderer.on('setup:progress', (_e, progress) => cb(progress)),

  onSetupComplete: (cb: () => void) =>
    ipcRenderer.on('setup:complete', () => cb()),

  onSetupError: (cb: (data: { error: string }) => void) =>
    ipcRenderer.on('setup:error', (_e, data) => cb(data)),

  setupCancel: (): Promise<void> => ipcRenderer.invoke('setup:cancel'),

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

  getCloudStatus: (): Promise<{
    mode: string;
    serverUrl: string | null;
    hasCredentials: boolean;
  }> => ipcRenderer.invoke('cloud:get-status'),

  cloudLogin: (serverUrl?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('cloud:login', serverUrl),

  cloudLogout: (): Promise<void> => ipcRenderer.invoke('cloud:logout'),

  onCloudStatusChanged: (cb: () => void) =>
    ipcRenderer.on('cloud:status-changed', cb),

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

  onChatToolCall: (cb: (data: { name: string; params: Record<string, unknown>; result: string }) => void) =>
    ipcRenderer.on('chat:tool-call', (_e, data) => cb(data)),

  chatReset: (): Promise<void> =>
    ipcRenderer.invoke('chat:reset'),

  // ── Updates ─────────────────────────────────────
  onUpdateAvailable: (cb: (info: { version: string }) => void) =>
    ipcRenderer.on('update:available', (_e, info) => cb(info)),

  onUpdateDownloaded: (cb: () => void) =>
    ipcRenderer.on('update:downloaded', () => cb()),

  installUpdate: () => ipcRenderer.send('update:install'),

  // ── GPU acceleration ────────────────────────────
  gpuDetect: (): Promise<Array<{ type: string; label: string; size: string }>> =>
    ipcRenderer.invoke('gpu:detect'),

  gpuStatus: (): Promise<{ installed: string | null }> =>
    ipcRenderer.invoke('gpu:status'),

  gpuActiveBackend: (): Promise<{ backend: string | null }> =>
    ipcRenderer.invoke('gpu:active-backend'),

  gpuInstall: (gpuType: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('gpu:install', gpuType),

  gpuRemove: (gpuType: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('gpu:remove', gpuType),

  // ── Models ──────────────────────────────────────
  listGgufFiles: (repoId: string): Promise<Array<{ filename: string; size: number }>> =>
    ipcRenderer.invoke('model:list-gguf', repoId),

  // ── Settings ─────────────────────────────────────
  configGet: (): Promise<unknown> => ipcRenderer.invoke('config:get'),

  configSave: (updates: unknown): Promise<{ restartRequired: boolean }> =>
    ipcRenderer.invoke('config:save', updates),

  openFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('open-folder-dialog'),

  copyToWatchFolder: (filePaths: string[]): Promise<{
    success: boolean;
    error?: string;
    results?: Array<{ path: string; error?: string }>;
  }> => ipcRenderer.invoke('drop:copy-to-watch', filePaths),

  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
});
