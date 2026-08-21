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
  filesDone: number;
  filesTotal: number;
};

export type ProcessedFile = {
  name: string;
  path: string;
  time: number;
};

// ── Setup / Onboarding types ────────────────────────

export type ModelOption = {
  id: string;
  label: string;
  size: string;
  recommended: boolean;
  runtimeGb?: number;
  supportedDims?: number[];
};

// Mirrors @nomnomdrive/shared's hardware-tiers.ts. The renderer can't import the
// shared barrel (it re-exports config.ts/models.ts, which need Node's fs/path/os),
// so these types are duplicated here — same reason as parseHfModelId in EmbedForm.
export type MemoryKind = 'vram' | 'unified' | 'ram';

export type HardwareProfile = {
  vramBytes: number;
  ramBytes: number;
  unified: boolean;
  gpuNames: string[];
  source: string;
};

export type ModelPick = {
  embedModelId: string;
  embedLabel: string;
  chatModelId: string | null;
  chatLabel: string | null;
  estimatedGb: number;
};

export type HardwareRecommendation = {
  tier: 'workstation' | 'high' | 'balanced' | 'light' | 'assisted' | 'api-only';
  tierLabel: string;
  totalGb: number;
  budgetGb: number;
  memoryKind: MemoryKind;
  local: ModelPick | null;
  localLight: ModelPick | null;
  preferred: 'local' | 'api';
  headline: string;
  detail: string;
};

export type HardwareReport = {
  profile: HardwareProfile;
  recommendation: HardwareRecommendation;
};

export type SetupStatusData = {
  needsSetup: boolean;
  needsModelDownload: boolean;
  existingConfig?: unknown;
  missingModels?: { embed: boolean; chat: boolean };
};

export type SetupProgressData = {
  phase: string;
  modelId: string;
  modelLabel: string;
  downloaded: number;
  total: number;
};

export type SetupCatalog = {
  embedModels: ModelOption[];
  chatModels: ModelOption[];
  defaults: {
    watchPath: string;
    embedModelId: string;
    chatModelId: string;
    mcpPort: number;
  };
};

export type SetupStoreState = {
  needsSetup: boolean;
  needsModelDownload: boolean;
  checked: boolean;
  error?: string;
};

export type EmbedConfigValue =
  | { provider: 'local'; model: string; truncateDim?: number }
  | { provider: 'openai'; model: string; apiKey: string; baseUrl?: string }
  | { provider: 'gemini'; model: string; apiKey: string };

export type ChatConfigValue =
  | { provider: 'local'; model: string }
  | { provider: 'openai'; model: string; apiKey: string; baseUrl?: string };
