"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSetupStatus = checkSetupStatus;
exports.getDefaultSetupOptions = getDefaultSetupOptions;
exports.runSetup = runSetup;
exports.downloadMissingModels = downloadMissingModels;
const config_1 = require("./config");
const models_1 = require("./models");
const model_catalog_1 = require("./model-catalog");
const constants_1 = require("./constants");
// ── Functions ────────────────────────────────────────────────────────────────
/**
 * Check whether first-run setup is needed, or only model downloads.
 */
async function checkSetupStatus() {
    const hasConfig = await (0, config_1.configExists)();
    if (!hasConfig) {
        return { needsSetup: true, needsModelDownload: true };
    }
    const config = await (0, config_1.loadConfig)();
    const embedMissing = !(await (0, models_1.modelExists)(config.model.localEmbed));
    const chatMissing = config.model.localChat
        ? !(await (0, models_1.modelExists)(config.model.localChat))
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
function getDefaultSetupOptions() {
    return {
        watchPath: (0, config_1.getDefaultDropFolder)(),
        embedModelId: constants_1.DEFAULT_EMBED_MODEL,
        chatModelId: constants_1.DEFAULT_CHAT_MODEL,
        mcpPort: constants_1.DEFAULT_MCP_PORT,
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
async function runSetup(options, onProgress, onPhaseStart) {
    const { watchPath, embedModelId, chatModelId, mcpPort } = options;
    const skipChat = chatModelId === model_catalog_1.MODEL_SKIP || !chatModelId;
    // Ensure watch folder exists
    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
    const expandedPath = (0, config_1.expandHome)(watchPath);
    if (!fs.existsSync(expandedPath)) {
        fs.mkdirSync(expandedPath, { recursive: true });
    }
    // Load existing config or create fresh
    let config;
    try {
        config = await (0, config_1.loadConfig)();
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
    }
    catch {
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
    await (0, config_1.saveConfig)(config);
    // ── Download embed model ──
    const embedLabel = model_catalog_1.EMBED_MODELS.find((m) => m.id === embedModelId)?.label ?? embedModelId;
    onPhaseStart?.('embed', embedModelId);
    const makeProgress = (phase, modelId, label) => {
        return (downloaded, total) => {
            onProgress?.({ phase, modelId, modelLabel: label, downloaded, total });
        };
    };
    await (0, models_1.resolveModelPath)(embedModelId, makeProgress('embed', embedModelId, embedLabel));
    // ── Download chat model ──
    if (!skipChat) {
        const chatLabel = model_catalog_1.CHAT_MODELS.find((m) => m.id === chatModelId)?.label ?? chatModelId;
        onPhaseStart?.('chat', chatModelId);
        await (0, models_1.resolveModelPath)(chatModelId, makeProgress('chat', chatModelId, chatLabel));
    }
    return config;
}
/**
 * Download only the missing models for an existing config.
 * Used when config exists but models were deleted or not yet downloaded.
 */
async function downloadMissingModels(config, onProgress, onPhaseStart) {
    const embedMissing = !(await (0, models_1.modelExists)(config.model.localEmbed));
    const chatMissing = config.model.localChat
        ? !(await (0, models_1.modelExists)(config.model.localChat))
        : false;
    const makeProgress = (phase, modelId, label) => {
        return (downloaded, total) => {
            onProgress?.({ phase, modelId, modelLabel: label, downloaded, total });
        };
    };
    if (embedMissing) {
        const label = model_catalog_1.EMBED_MODELS.find((m) => m.id === config.model.localEmbed)?.label ?? config.model.localEmbed;
        onPhaseStart?.('embed', config.model.localEmbed);
        await (0, models_1.resolveModelPath)(config.model.localEmbed, makeProgress('embed', config.model.localEmbed, label));
    }
    if (chatMissing) {
        const label = model_catalog_1.CHAT_MODELS.find((m) => m.id === config.model.localChat)?.label ?? config.model.localChat;
        onPhaseStart?.('chat', config.model.localChat);
        await (0, models_1.resolveModelPath)(config.model.localChat, makeProgress('chat', config.model.localChat, label));
    }
}
//# sourceMappingURL=setup-engine.js.map