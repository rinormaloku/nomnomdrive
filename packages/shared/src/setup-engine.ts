import {
  configExists,
  loadConfig,
  saveConfig,
  getDefaultDropFolder,
  getEmbedConfig,
  expandHome,
  type AppConfig,
  type EmbedConfig,
  type ChatConfig,
} from './config';
import { resolveModelPath, modelExists, type ProgressCallback } from './models';
import { EMBED_MODELS, CHAT_MODELS, MODEL_SKIP } from './model-catalog';
import { DEFAULT_EMBED_MODEL, DEFAULT_CHAT_MODEL, DEFAULT_MCP_PORT } from './constants';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SetupOptions {
  watchPath: string;
  embedModelId: string;
  embedConfig?: EmbedConfig; // when set, overrides embedModelId and skips local download
  chatModelId: string; // use MODEL_SKIP to skip
  chatConfig?: ChatConfig; // when set, overrides chatModelId and skips local download for remote providers
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
  const embedCfg = getEmbedConfig(config);
  const embedMissing = embedCfg.provider === 'local'
    ? !(await modelExists(embedCfg.model))
    : false; // remote providers don't need local files
  const isRemoteChat = config.chat && config.chat.provider !== 'local';
  const chatMissing = !isRemoteChat && config.model.localChat
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
  signal?: AbortSignal,
): Promise<AppConfig> {
  const { watchPath, embedModelId, embedConfig, chatModelId, chatConfig, mcpPort } = options;
  const isRemoteChat = chatConfig && chatConfig.provider !== 'local';
  const skipChat = isRemoteChat || chatModelId === MODEL_SKIP || !chatModelId;
  const isRemoteEmbed = embedConfig && embedConfig.provider !== 'local';

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
        localEmbed: isRemoteEmbed ? config.model.localEmbed : embedModelId,
        localChat: isRemoteChat ? config.model.localChat : (skipChat ? '' : chatModelId),
      },
      embed: embedConfig,
      chat: chatConfig,
      mcp: { port: mcpPort },
    };
  } catch {
    config = {
      mode: 'local',
      watch: { paths: [expandedPath], glob: '**/*' },
      model: {
        localEmbed: isRemoteEmbed ? DEFAULT_EMBED_MODEL : embedModelId,
        localChat: isRemoteChat ? '' : (skipChat ? '' : chatModelId),
      },
      embed: embedConfig,
      chat: chatConfig,
      mcp: { port: mcpPort },
    };
  }

  await saveConfig(config);

  const makeProgress = (phase: SetupPhase, modelId: string, label: string): ProgressCallback => {
    return (downloaded: number, total: number) => {
      onProgress?.({ phase, modelId, modelLabel: label, downloaded, total });
    };
  };

  // ── Download embed model (local only) ──
  if (!isRemoteEmbed) {
    const embedLabel = EMBED_MODELS.find((m) => m.id === embedModelId)?.label ?? embedModelId;
    onPhaseStart?.('embed', embedModelId);
    await resolveModelPath(embedModelId, makeProgress('embed', embedModelId, embedLabel), signal);
  }

  // ── Download chat model ──
  if (!skipChat) {
    const chatLabel = CHAT_MODELS.find((m) => m.id === chatModelId)?.label ?? chatModelId;
    onPhaseStart?.('chat', chatModelId);
    await resolveModelPath(chatModelId, makeProgress('chat', chatModelId, chatLabel), signal);
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
  signal?: AbortSignal,
): Promise<void> {
  const embedCfg = getEmbedConfig(config);
  const embedMissing = embedCfg.provider === 'local'
    ? !(await modelExists(embedCfg.model))
    : false;
  const chatMissing = config.model.localChat
    ? !(await modelExists(config.model.localChat))
    : false;

  const makeProgress = (phase: SetupPhase, modelId: string, label: string): ProgressCallback => {
    return (downloaded: number, total: number) => {
      onProgress?.({ phase, modelId, modelLabel: label, downloaded, total });
    };
  };

  if (embedMissing && embedCfg.provider === 'local') {
    const label = EMBED_MODELS.find((m) => m.id === embedCfg.model)?.label ?? embedCfg.model;
    onPhaseStart?.('embed', embedCfg.model);
    await resolveModelPath(embedCfg.model, makeProgress('embed', embedCfg.model, label), signal);
  }

  if (chatMissing) {
    const label = CHAT_MODELS.find((m) => m.id === config.model.localChat)?.label ?? config.model.localChat;
    onPhaseStart?.('chat', config.model.localChat);
    await resolveModelPath(config.model.localChat, makeProgress('chat', config.model.localChat, label), signal);
  }
}
