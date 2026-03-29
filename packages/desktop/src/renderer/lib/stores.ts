import { writable } from 'svelte/store';

export type CloudStatus = { mode: string; serverUrl: string | null; hasCredentials: boolean };
export const cloudStatus = writable<CloudStatus | null>(null);
import type { Config, Document, ProcessedFile, Stats, SyncProgress, SetupStoreState, SetupProgressData } from './types';

export const config = writable<Config>({ dropFolder: '', mcpPort: null, chatConfigured: false });
export const documents = writable<Document[]>([]);
export const stats = writable<Stats>({ fileCount: 0, chunkCount: 0 });

export const syncActive = writable(false);
export const syncProgress = writable<SyncProgress>({
  filePath: '',
  phase: '',
  chunksProcessed: 0,
  chunksTotal: 0,
  queueLength: 0,
});
export const processedFiles = writable<ProcessedFile[]>([]);

export const activeTab = writable<'files' | 'chat' | 'mcp' | 'cloud' | 'settings'>('files');

export const updateReady = writable(false);

/** Non-null when the embedding model failed to load — blocks indexing. */
export const modelError = writable<string | null>(null);

export const toastStore = writable<{ message: string; visible: boolean }>({
  message: '',
  visible: false,
});

// ── Setup / Onboarding stores ────────────────────────
export const setupStatus = writable<SetupStoreState>({
  needsSetup: false,
  needsModelDownload: false,
  checked: false,
});

export const setupProgress = writable<SetupProgressData>({
  phase: '',
  modelId: '',
  modelLabel: '',
  downloaded: 0,
  total: 0,
});

export const setupGpuFailed = writable<{ gpuType: string; error: string } | null>(null);

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function showToast(message: string, duration = 2000) {
  if (toastTimer) clearTimeout(toastTimer);
  toastStore.set({ message, visible: true });
  toastTimer = setTimeout(() => toastStore.set({ message, visible: false }), duration);
}
