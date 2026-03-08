"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCloudCredentialsPath = getCloudCredentialsPath;
exports.loadCloudCredentials = loadCloudCredentials;
exports.saveCloudCredentials = saveCloudCredentials;
exports.deleteCloudCredentials = deleteCloudCredentials;
exports.expandHome = expandHome;
exports.getConfigDir = getConfigDir;
exports.getConfigPath = getConfigPath;
exports.getDataDir = getDataDir;
exports.getDbPath = getDbPath;
exports.getModelsDir = getModelsDir;
exports.getDaemonSockPath = getDaemonSockPath;
exports.getDefaultDropFolder = getDefaultDropFolder;
exports.getDefaultConfig = getDefaultConfig;
exports.configExists = configExists;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.addWatchPath = addWatchPath;
exports.removeWatchPath = removeWatchPath;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const yaml_1 = __importDefault(require("yaml"));
const constants_1 = require("./constants");
function getCloudCredentialsPath() {
    return path_1.default.join(getConfigDir(), 'cloud-credentials.json');
}
async function loadCloudCredentials() {
    try {
        const raw = await promises_1.default.readFile(getCloudCredentialsPath(), 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function saveCloudCredentials(creds) {
    const dir = getConfigDir();
    await promises_1.default.mkdir(dir, { recursive: true });
    await promises_1.default.writeFile(getCloudCredentialsPath(), JSON.stringify(creds, null, 2), 'utf-8');
}
async function deleteCloudCredentials() {
    try {
        await promises_1.default.unlink(getCloudCredentialsPath());
    }
    catch {
        // ignore — file may not exist
    }
}
function expandHome(p) {
    if (p.startsWith('~/') || p === '~') {
        return path_1.default.join(os_1.default.homedir(), p.slice(2));
    }
    return p;
}
function getConfigDir() {
    return path_1.default.join(os_1.default.homedir(), '.config', 'nomnomdrive');
}
function getConfigPath() {
    return path_1.default.join(getConfigDir(), 'config.yaml');
}
function getDataDir() {
    return path_1.default.join(os_1.default.homedir(), '.local', 'share', 'nomnomdrive');
}
function getDbPath() {
    return path_1.default.join(getDataDir(), 'local.db');
}
function getModelsDir() {
    return path_1.default.join(getDataDir(), 'models');
}
function getDaemonSockPath() {
    return path_1.default.join(getDataDir(), 'daemon.sock');
}
function getDefaultDropFolder() {
    return path_1.default.join(os_1.default.homedir(), 'Documents', 'NomNomDrive');
}
function getDefaultConfig() {
    return {
        mode: 'local',
        watch: {
            paths: [getDefaultDropFolder()],
            glob: '**/*',
        },
        model: {
            localEmbed: constants_1.DEFAULT_EMBED_MODEL,
            localChat: constants_1.DEFAULT_CHAT_MODEL,
        },
        mcp: {
            port: constants_1.DEFAULT_MCP_PORT,
        },
    };
}
async function configExists() {
    try {
        await promises_1.default.access(getConfigPath());
        return true;
    }
    catch {
        return false;
    }
}
async function loadConfig() {
    const configPath = getConfigPath();
    try {
        const raw = await promises_1.default.readFile(configPath, 'utf-8');
        const parsed = yaml_1.default.parse(raw);
        const defaults = getDefaultConfig();
        return {
            mode: parsed.mode ?? defaults.mode,
            watch: {
                paths: (parsed.watch?.paths ??
                    defaults.watch.paths).map(expandHome),
                glob: parsed.watch?.glob ?? defaults.watch.glob,
            },
            model: {
                localEmbed: parsed.model?.local_embed ??
                    defaults.model.localEmbed,
                localChat: parsed.model?.local_chat ??
                    defaults.model.localChat,
            },
            mcp: {
                port: parsed.mcp?.port ?? defaults.mcp.port,
            },
            cloud: parsed.cloud?.server_url
                ? { serverUrl: parsed.cloud.server_url }
                : undefined,
        };
    }
    catch {
        return getDefaultConfig();
    }
}
async function saveConfig(config) {
    const configDir = getConfigDir();
    await promises_1.default.mkdir(configDir, { recursive: true });
    const raw = yaml_1.default.stringify({
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
    await promises_1.default.writeFile(getConfigPath(), raw, 'utf-8');
}
async function addWatchPath(folderPath) {
    const config = await loadConfig();
    const resolved = expandHome(folderPath);
    if (!config.watch.paths.includes(resolved)) {
        config.watch.paths.push(resolved);
        await saveConfig(config);
    }
    return config;
}
async function removeWatchPath(folderPath) {
    const config = await loadConfig();
    const resolved = expandHome(folderPath);
    config.watch.paths = config.watch.paths.filter((p) => p !== resolved);
    await saveConfig(config);
    return config;
}
//# sourceMappingURL=config.js.map