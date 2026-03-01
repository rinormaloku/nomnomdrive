import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface McpServerEntry {
  url: string;
}

interface McpJsonConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

const HOME = os.homedir();

function getClaudeDesktopConfigPath(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32':
      return path.join(process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    default: // linux
      return path.join(HOME, '.config', 'Claude', 'claude_desktop_config.json');
  }
}

function getCursorConfigPath(): string {
  return path.join(HOME, '.cursor', 'mcp.json');
}

function getVSCodeConfigPath(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
    case 'win32':
      return path.join(process.env.APPDATA ?? '', 'Code', 'User', 'mcp.json');
    default:
      return path.join(HOME, '.config', 'Code', 'User', 'mcp.json');
  }
}

async function patchMcpConfig(configPath: string, mcpPort: number): Promise<boolean> {
  const dir = path.dirname(configPath);

  // Check if the config directory exists (indicates client is installed)
  try {
    await fs.access(dir);
  } catch {
    return false; // Client not installed
  }

  let config: McpJsonConfig = {};
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw) as McpJsonConfig;
  } catch {
    // Config doesn't exist yet — create it
  }

  // Backup existing config
  try {
    await fs.copyFile(configPath, configPath + '.bak');
  } catch {
    // No existing file to backup
  }

  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers['nomnomdrive'] = {
    url: `http://localhost:${mcpPort}/mcp`,
  };

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return true;
}

export interface RegistrationResult {
  client: string;
  registered: boolean;
  configPath: string;
}

export async function registerMcpClients(mcpPort: number): Promise<RegistrationResult[]> {
  const clients = [
    { client: 'Claude Desktop', configPath: getClaudeDesktopConfigPath() },
    { client: 'Cursor', configPath: getCursorConfigPath() },
    { client: 'VS Code', configPath: getVSCodeConfigPath() },
  ];

  const results: RegistrationResult[] = [];

  for (const { client, configPath } of clients) {
    const registered = await patchMcpConfig(configPath, mcpPort);
    results.push({ client, registered, configPath });
  }

  return results;
}

/** Patch a single MCP client config by name (used by the renderer one-click install). */
export async function patchMcpClientByName(
  clientName: string,
  mcpPort: number,
): Promise<RegistrationResult> {
  const clientMap: Record<string, { client: string; configPath: string }> = {
    'vscode': { client: 'VS Code', configPath: getVSCodeConfigPath() },
    'cursor': { client: 'Cursor', configPath: getCursorConfigPath() },
    'claude-desktop': { client: 'Claude Desktop', configPath: getClaudeDesktopConfigPath() },
  };

  const entry = clientMap[clientName];
  if (!entry) {
    return { client: clientName, registered: false, configPath: '' };
  }

  const registered = await patchMcpConfig(entry.configPath, mcpPort);
  return { client: entry.client, registered, configPath: entry.configPath };
}
