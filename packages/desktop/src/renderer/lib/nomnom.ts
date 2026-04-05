import { config, documents, processedFiles, stats, syncActive, syncProgress, updateReady, setupStatus, setupProgress, setupGpuFailed, modelError } from './stores';
import { basename } from './utils';
import type { Document, SetupStatusData, SetupProgressData, ModelOption, SetupCatalog } from './types';

declare global {
  interface Window {
    nomnom: {
      onIndexingProgress: (
        cb: (data: {
          filePath: string;
          chunksProcessed: number;
          chunksTotal: number;
          phase: string;
          queueLength?: number;
        }) => void,
      ) => void;
      onIndexingComplete: (cb: (data: { filePath: string; chunkCount: number }) => void) => void;
      onIndexingError: (cb: (data: { filePath: string; error: string }) => void) => void;
      onIndexingDeleted: (cb: (data: { filePath: string }) => void) => void;
      onModelReady: (cb: () => void) => void;
      onModelError: (cb: (data: { error: string }) => void) => void;
      onConfig: (
        cb: (config: { dropFolder: string; mcpPort: number | null; chatConfigured: boolean }) => void,
      ) => void;
      // Setup / Onboarding
      setupCheck: () => Promise<SetupStatusData>;
      setupGetCatalog: () => Promise<SetupCatalog>;
      setupStart: (options: {
        watchPath: string;
        embedModelId: string;
        embedConfig?: unknown;
        chatModelId: string;
        chatConfig?: unknown;
        mcpPort: number;
        gpuType?: string;
      }) => Promise<{ success: boolean; error?: string }>;
      onSetupProgress: (cb: (progress: SetupProgressData) => void) => void;
      onSetupComplete: (cb: () => void) => void;
      onSetupError: (cb: (data: { error: string }) => void) => void;
      onSetupGpuFailed: (cb: (data: { gpuType: string; error: string }) => void) => void;
      setupCancel: () => Promise<void>;
      // Chat
      onChatChunk: (cb: (chunk: string) => void) => void;
      onChatToolCall: (cb: (data: { name: string; params: Record<string, unknown>; result: string }) => void) => void;
      openDropFolder: (folderPath: string) => void;
      openExternalUrl: (url: string) => void;
      openFile: (filePath: string) => void;
      getDocuments: () => Promise<Document[]>;
      getStats: () => Promise<{ fileCount: number; chunkCount: number }>;
      getCloudStatus: () => Promise<{ mode: string; serverUrl: string | null; hasCredentials: boolean }>;
      cloudLogin: (serverUrl?: string) => Promise<{ success: boolean; error?: string }>;
      cloudLogout: () => Promise<void>;
      onCloudStatusChanged: (cb: () => void) => void;
      registerMcpClient: (
        client: string,
      ) => Promise<{ client: string; registered: boolean; configPath: string }>;
      chatInit: () => Promise<{ ready: boolean }>;
      chatSend: (message: string) => Promise<string>;
      chatReset: () => Promise<void>;
      onUpdateAvailable: (cb: (info: { version: string }) => void) => void;
      onUpdateDownloaded: (cb: () => void) => void;
      installUpdate: () => void;
      // GPU acceleration
      gpuDetect: () => Promise<Array<{ type: string; label: string; size: string }>>;
      gpuStatus: () => Promise<{ installed: string | null; validated?: boolean }>;
      gpuActiveBackend: () => Promise<{ backend: string | null }>;
      gpuInstall: (gpuType: string) => Promise<{ success: boolean; error?: string }>;
      gpuRemove: (gpuType: string) => Promise<{ success: boolean; error?: string }>;
      // Models
      listGgufFiles: (repoId: string) => Promise<Array<{ filename: string; size: number }>>;
      // Launch at startup
      getOpenAtLogin: () => Promise<boolean>;
      setOpenAtLogin: (enabled: boolean) => Promise<{ success: boolean }>;
      // Settings
      configGet: () => Promise<unknown>;
      configSave: (updates: unknown) => Promise<{ restartRequired: boolean }>;
      openFolderDialog: () => Promise<string | null>;
      copyToWatchFolder: (filePaths: string[]) => Promise<{
        success: boolean;
        error?: string;
        results?: Array<{ path: string; error?: string }>;
      }>;
      getPathForFile: (file: File) => string;
    };
  }
}

let idleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastProgressFile = '';

function refreshDocs() {
  window.nomnom.getDocuments().then((docs) => documents.set(docs));
  window.nomnom.getStats().then((s) => stats.set(s));
}

function scheduleIdle() {
  if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
  idleDebounceTimer = setTimeout(() => {
    idleDebounceTimer = null;
    syncActive.set(false);
    processedFiles.set([]);
    lastProgressFile = '';
  }, 400);
}

export function initNomnom() {
  window.nomnom.onConfig((cfg) => {
    config.set(cfg);
    refreshDocs();
  });

  window.nomnom.onIndexingProgress((data) => {
    if (idleDebounceTimer) {
      clearTimeout(idleDebounceTimer);
      idleDebounceTimer = null;
    }
    syncActive.set(true);
    lastProgressFile = data.filePath;
    syncProgress.set({
      filePath: data.filePath,
      phase: data.phase,
      chunksProcessed: data.chunksProcessed,
      chunksTotal: data.chunksTotal,
      queueLength: data.queueLength || 0,
    });
  });

  window.nomnom.onIndexingComplete(() => {
    if (lastProgressFile) {
      const name = basename(lastProgressFile);
      processedFiles.update((files) => {
        return [{ name, path: lastProgressFile, time: Date.now() }, ...files].slice(0, 50);
      });
    }
    scheduleIdle();
    refreshDocs();
  });

  window.nomnom.onIndexingError(() => {
    scheduleIdle();
    refreshDocs();
  });

  window.nomnom.onIndexingDeleted(() => {
    refreshDocs();
  });

  // Chat chunks are dispatched as custom DOM events so ChatTab can
  // subscribe without store deduplication issues on repeated tokens.
  window.nomnom.onChatChunk((chunk) => {
    window.dispatchEvent(new CustomEvent('chat-chunk', { detail: chunk }));
  });

  window.nomnom.onChatToolCall((data) => {
    window.dispatchEvent(new CustomEvent('chat-tool-call', { detail: data }));
  });

  window.nomnom.onModelReady(() => {
    modelError.set(null);
  });

  window.nomnom.onModelError(({ error }) => {
    modelError.set(error);
  });

  window.nomnom.onUpdateDownloaded(() => {
    updateReady.set(true);
  });

  // Setup / onboarding events
  window.nomnom.onSetupProgress((progress) => {
    setupProgress.set(progress);
  });

  window.nomnom.onSetupComplete(() => {
    setupStatus.set({ needsSetup: false, needsModelDownload: false, checked: true });
  });

  window.nomnom.onSetupError((data) => {
    setupStatus.update((s) => ({ ...s, error: data.error }));
  });

  window.nomnom.onSetupGpuFailed((data) => {
    setupGpuFailed.set(data);
  });
}

// Direct API wrappers for use in components
export const nomnom = {
  openDropFolder: (path: string) => window.nomnom.openDropFolder(path),
  openExternalUrl: (url: string) => window.nomnom.openExternalUrl(url),
  openFile: (path: string) => window.nomnom.openFile(path),
  registerMcpClient: (client: string) => window.nomnom.registerMcpClient(client),
  chatInit: () => window.nomnom.chatInit(),
  chatSend: (msg: string) => window.nomnom.chatSend(msg),
  chatReset: () => window.nomnom.chatReset(),
  setupCheck: () => window.nomnom.setupCheck(),
  setupGetCatalog: () => window.nomnom.setupGetCatalog(),
  setupStart: (options: { watchPath: string; embedModelId: string; embedConfig?: unknown; chatModelId: string; chatConfig?: unknown; mcpPort: number; gpuType?: string }) =>
    window.nomnom.setupStart(options),
  setupCancel: () => window.nomnom.setupCancel(),
  getCloudStatus: () => window.nomnom.getCloudStatus(),
  cloudLogin: (serverUrl?: string) => window.nomnom.cloudLogin(serverUrl),
  cloudLogout: () => window.nomnom.cloudLogout(),
  onCloudStatusChanged: (cb: () => void) => window.nomnom.onCloudStatusChanged(cb),
  gpuDetect: () => window.nomnom.gpuDetect(),
  gpuStatus: () => window.nomnom.gpuStatus(),
  gpuActiveBackend: () => window.nomnom.gpuActiveBackend(),
  gpuInstall: (gpuType: string) => window.nomnom.gpuInstall(gpuType),
  gpuRemove: (gpuType: string) => window.nomnom.gpuRemove(gpuType),
  listGgufFiles: (repoId: string) => window.nomnom.listGgufFiles(repoId),
  getOpenAtLogin: () => window.nomnom.getOpenAtLogin(),
  setOpenAtLogin: (enabled: boolean) => window.nomnom.setOpenAtLogin(enabled),
  configGet: () => window.nomnom.configGet(),
  configSave: (updates: unknown) => window.nomnom.configSave(updates),
  openFolderDialog: () => window.nomnom.openFolderDialog(),
  copyToWatchFolder: (filePaths: string[]) => window.nomnom.copyToWatchFolder(filePaths),
  getPathForFile: (file: File) => window.nomnom.getPathForFile(file),
};
