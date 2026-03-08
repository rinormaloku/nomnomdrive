"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMcpClients = registerMcpClients;
exports.patchMcpClientByName = patchMcpClientByName;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const HOME = os_1.default.homedir();
function getClaudeDesktopConfigPath() {
    switch (process.platform) {
        case 'darwin':
            return path_1.default.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        case 'win32':
            return path_1.default.join(process.env.APPDATA ?? path_1.default.join(HOME, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
        default: // linux
            return path_1.default.join(HOME, '.config', 'Claude', 'claude_desktop_config.json');
    }
}
function getCursorConfigPath() {
    return path_1.default.join(HOME, '.cursor', 'mcp.json');
}
function getVSCodeConfigPath() {
    switch (process.platform) {
        case 'darwin':
            return path_1.default.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
        case 'win32':
            return path_1.default.join(process.env.APPDATA ?? '', 'Code', 'User', 'mcp.json');
        default:
            return path_1.default.join(HOME, '.config', 'Code', 'User', 'mcp.json');
    }
}
async function patchMcpConfig(configPath, mcpPort) {
    const dir = path_1.default.dirname(configPath);
    // Check if the config directory exists (indicates client is installed)
    try {
        await promises_1.default.access(dir);
    }
    catch {
        return false; // Client not installed
    }
    let config = {};
    try {
        const raw = await promises_1.default.readFile(configPath, 'utf-8');
        config = JSON.parse(raw);
    }
    catch {
        // Config doesn't exist yet — create it
    }
    // Backup existing config
    try {
        await promises_1.default.copyFile(configPath, configPath + '.bak');
    }
    catch {
        // No existing file to backup
    }
    config.mcpServers = config.mcpServers ?? {};
    config.mcpServers['nomnomdrive'] = {
        url: `http://localhost:${mcpPort}/mcp`,
    };
    await promises_1.default.mkdir(dir, { recursive: true });
    await promises_1.default.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
}
async function registerMcpClients(mcpPort) {
    const clients = [
        { client: 'Claude Desktop', configPath: getClaudeDesktopConfigPath() },
        { client: 'Cursor', configPath: getCursorConfigPath() },
        { client: 'VS Code', configPath: getVSCodeConfigPath() },
    ];
    const results = [];
    for (const { client, configPath } of clients) {
        const registered = await patchMcpConfig(configPath, mcpPort);
        results.push({ client, registered, configPath });
    }
    return results;
}
/** Patch a single MCP client config by name (used by the renderer one-click install). */
async function patchMcpClientByName(clientName, mcpPort) {
    const clientMap = {
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
//# sourceMappingURL=mcp-register.js.map