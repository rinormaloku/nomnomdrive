import {
  configExists,
  loadConfig,
  saveConfig,
  getDefaultDropFolder,
  expandHome,
  type AppConfig,
} from './config';
import { resolveModelPath, modelExists, type ProgressCallback } from './models';
import { EMBED_MODELS, CHAT_MODELS, MODEL_SKIP } from './model-catalog';
import { DEFAULT_EMBED_MODEL, DEFAULT_CHAT_MODEL, DEFAULT_MCP_PORT } from './constants';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SetupOptions {
  watchPath: string;
  embedModelId: string;
  chatModelId: string; // use MODEL_SKIP to skip
  mcpPort: number;
}

export type SetupPhase = 'embed' | 'chat';

export interface SetupProgress {
  phase: SetupPhase;
  modelId: string;
  modelLabel: string;
  downloaded: number;
  total: number;
}

export interface SetupStatus {
  needsSetup: boolean;
  needsModelDownload: boolean;
  existingConfig?: AppConfig;
  missingModels?: { embed: boolean; chat: boolean };
}

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Check whether first-run setup is needed, or only model downloads.
 */
export async function checkSetupStatus(): Promise<SetupStatus> {
  const hasConfig = await configExists();

  if (!hasConfig) {
    return { needsSetup: true, needsModelDownload: true };
  }

  const config = await loadConfig();
  const embedMissing = !(await modelExists(config.model.localEmbed));
  const chatMissing = config.model.localChat
    ? !(await modelExists(config.model.localChat))
    : false;

  return {
    needsSetup: false,
    needsModelDownload: embedMissing || chatMissing,
    existingConfig: config,
    missingModels: { embed: embedMissing, chat: chatMissing },
  };
}

/**
 * Returns the default setup options.
 */
export function getDefaultSetupOptions(): SetupOptions {
  return {
    watchPath: getDefaultDropFolder(),
    embedModelId: DEFAULT_EMBED_MODEL,
    chatModelId: DEFAULT_CHAT_MODEL,
    mcpPort: DEFAULT_MCP_PORT,
  };
}

/**
 * Run the full setup: save config + download models.
 * This is the shared core that both CLI and Desktop UI call.
 *
 * @param options  User-selected setup options
 * @param onProgress  Called repeatedly during model downloads
 * @param onPhaseStart  Called when a new download phase begins (optional)
 */
export async function runSetup(
  options: SetupOptions,
  onProgress?: (progress: SetupProgress) => void,
  onPhaseStart?: (phase: SetupPhase, modelId: string) => void,
): Promise<AppConfig> {
  const { watchPath, embedModelId, chatModelId, mcpPort } = options;
  const skipChat = chatModelId === MODEL_SKIP || !chatModelId;

  // Ensure watch folder exists
  const fs = await import('fs');
  const expandedPath = expandHome(watchPath);
  if (!fs.existsSync(expandedPath)) {
    fs.mkdirSync(expandedPath, { recursive: true });
  }

  // Load existing config or create fresh
  let config: AppConfig;
  try {
    config = await loadConfig();
    // Merge new paths with existing
    const paths = [...new Set([...config.watch.paths, expandedPath])];
    config = {
      ...config,
      watch: { ...config.watch, paths },
      model: {
        localEmbed: embedModelId,
        localChat: skipChat ? '' : chatModelId,
      },
      mcp: { port: mcpPort },
    };
  } catch {
    config = {
      mode: 'local',
      watch: { paths: [expandedPath], glob: '**/*' },
      model: {
        localEmbed: embedModelId,
        localChat: skipChat ? '' : chatModelId,
      },
      mcp: { port: mcpPort },
    };
  }

  await saveConfig(config);

  // ── Download embed model ──
  const embedLabel = EMBED_MODELS.find((m) => m.id === embedModelId)?.label ?? embedModelId;
  onPhaseStart?.('embed', embedModelId);

  const makeProgress = (phase: SetupPhase, modelId: string, label: string): ProgressCallback => {
    return (downloaded: number, total: number) => {
      onProgress?.({ phase, modelId, modelLabel: label, downloaded, total });
    };
  };

  await resolveModelPath(embedModelId, makeProgress('embed', embedModelId, embedLabel));

  // ── Download chat model ──
  if (!skipChat) {
    const chatLabel = CHAT_MODELS.find((m) => m.id === chatModelId)?.label ?? chatModelId;
    onPhaseStart?.('chat', chatModelId);
    await resolveModelPath(chatModelId, makeProgress('chat', chatModelId, chatLabel));
  }

  return config;
}

/**
 * Download only the missing models for an existing config.
 * Used when config exists but models were deleted or not yet downloaded.
 */
export async function downloadMissingModels(
  config: AppConfig,
  onProgress?: (progress: SetupProgress) => void,
  onPhaseStart?: (phase: SetupPhase, modelId: string) => void,
): Promise<void> {
  const embedMissing = !(await modelExists(config.model.localEmbed));
  const chatMissing = config.model.localChat
    ? !(await modelExists(config.model.localChat))
    : false;

  const makeProgress = (phase: SetupPhase, modelId: string, label: string): ProgressCallback => {
    return (downloaded: number, total: number) => {
      onProgress?.({ phase, modelId, modelLabel: label, downloaded, total });
    };
  };

  if (embedMissing) {
    const label = EMBED_MODELS.find((m) => m.id === config.model.localEmbed)?.label ?? config.model.localEmbed;
    onPhaseStart?.('embed', config.model.localEmbed);
    await resolveModelPath(config.model.localEmbed, makeProgress('embed', config.model.localEmbed, label));
  }

  if (chatMissing) {
    const label = CHAT_MODELS.find((m) => m.id === config.model.localChat)?.label ?? config.model.localChat;
    onPhaseStart?.('chat', config.model.localChat);
    await resolveModelPath(config.model.localChat, makeProgress('chat', config.model.localChat, label));
  }
}
