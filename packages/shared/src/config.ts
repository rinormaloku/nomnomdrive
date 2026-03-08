import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { DEFAULT_EMBED_MODEL, DEFAULT_CHAT_MODEL, DEFAULT_MCP_PORT } from './constants';

export interface WatchConfig {
  paths: string[];
  glob: string;
}

export interface ModelConfig {
  localEmbed: string;
  localChat: string;
}

export interface McpConfig {
  port: number;
}

export interface CloudConfig {
  serverUrl: string;
}

export interface AppConfig {
  mode: 'local' | 'cloud';
  watch: WatchConfig;
  model: ModelConfig;
  mcp: McpConfig;
  cloud?: CloudConfig;
}

export interface CloudCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export function getCloudCredentialsPath(): string {
  return path.join(getConfigDir(), 'cloud-credentials.json');
}

export async function loadCloudCredentials(): Promise<CloudCredentials | null> {
  try {
    const raw = await fs.readFile(getCloudCredentialsPath(), 'utf-8');
    return JSON.parse(raw) as CloudCredentials;
  } catch {
    return null;
  }
}

export async function saveCloudCredentials(creds: CloudCredentials): Promise<void> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getCloudCredentialsPath(), JSON.stringify(creds, null, 2), 'utf-8');
}

export async function deleteCloudCredentials(): Promise<void> {
  try {
    await fs.unlink(getCloudCredentialsPath());
  } catch {
    // ignore — file may not exist
  }
}

export function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'nomnomdrive');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.yaml');
}

export function getDataDir(): string {
  return path.join(os.homedir(), '.local', 'share', 'nomnomdrive');
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'local.db');
}

export function getModelsDir(): string {
  return path.join(getDataDir(), 'models');
}

export function getDaemonSockPath(): string {
  return path.join(getDataDir(), 'daemon.sock');
}

export function getDefaultDropFolder(): string {
  return path.join(os.homedir(), 'Documents', 'NomNomDrive');
}

export function getDefaultConfig(): AppConfig {
  return {
    mode: 'local',
    watch: {
      paths: [getDefaultDropFolder()],
      glob: '**/*',
    },
    model: {
      localEmbed: DEFAULT_EMBED_MODEL,
      localChat: DEFAULT_CHAT_MODEL,
    },
    mcp: {
      port: DEFAULT_MCP_PORT,
    },
  };
}

export async function configExists(): Promise<boolean> {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = YAML.parse(raw) as Record<string, unknown>;
    const defaults = getDefaultConfig();
    return {
      mode: (parsed.mode as 'local' | 'cloud') ?? defaults.mode,
      watch: {
        paths: (((parsed.watch as Record<string, unknown>)?.paths as string[]) ??
          defaults.watch.paths).map(expandHome),
        glob:
          ((parsed.watch as Record<string, unknown>)?.glob as string) ?? defaults.watch.glob,
      },
      model: {
        localEmbed:
          ((parsed.model as Record<string, unknown>)?.local_embed as string) ??
          defaults.model.localEmbed,
        localChat:
          ((parsed.model as Record<string, unknown>)?.local_chat as string) ??
          defaults.model.localChat,
      },
      mcp: {
        port:
          ((parsed.mcp as Record<string, unknown>)?.port as number) ?? defaults.mcp.port,
      },
      cloud: (parsed.cloud as Record<string, unknown>)?.server_url
        ? { serverUrl: (parsed.cloud as Record<string, unknown>).server_url as string }
        : undefined,
    };
  } catch {
    return getDefaultConfig();
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });
  const raw = YAML.stringify({
    mode: config.mode,
    watch: {
      paths: config.watch.paths,
      glob: config.watch.glob,
    },
    model: {
      local_embed: config.model.localEmbed,
      local_chat: config.model.localChat,
    },
    mcp: {
      port: config.mcp.port,
    },
    ...(config.cloud ? { cloud: { server_url: config.cloud.serverUrl } } : {}),
  });
  await fs.writeFile(getConfigPath(), raw, 'utf-8');
}

export async function addWatchPath(folderPath: string): Promise<AppConfig> {
  const config = await loadConfig();
  const resolved = expandHome(folderPath);
  if (!config.watch.paths.includes(resolved)) {
    config.watch.paths.push(resolved);
    await saveConfig(config);
  }
  return config;
}

export async function removeWatchPath(folderPath: string): Promise<AppConfig> {
  const config = await loadConfig();
  const resolved = expandHome(folderPath);
  config.watch.paths = config.watch.paths.filter((p) => p !== resolved);
  await saveConfig(config);
  return config;
}
