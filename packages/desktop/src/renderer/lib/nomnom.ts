import { config, documents, processedFiles, stats, syncActive, syncProgress, updateReady } from './stores';
import { basename } from './utils';
import type { Document } from './types';

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
      onConfig: (
        cb: (config: { dropFolder: string; mcpPort: number | null; chatConfigured: boolean }) => void,
      ) => void;
      onChatChunk: (cb: (chunk: string) => void) => void;
      openDropFolder: (folderPath: string) => void;
      openExternalUrl: (url: string) => void;
      openFile: (filePath: string) => void;
      getDocuments: () => Promise<Document[]>;
      getStats: () => Promise<{ fileCount: number; chunkCount: number }>;
      registerMcpClient: (
        client: string,
      ) => Promise<{ client: string; registered: boolean; configPath: string }>;
      chatInit: () => Promise<{ ready: boolean }>;
      chatSend: (message: string) => Promise<string>;
      chatReset: () => Promise<void>;
      onUpdateAvailable: (cb: (info: { version: string }) => void) => void;
      onUpdateDownloaded: (cb: () => void) => void;
      installUpdate: () => void;
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

  window.nomnom.onUpdateDownloaded(() => {
    updateReady.set(true);
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
};
