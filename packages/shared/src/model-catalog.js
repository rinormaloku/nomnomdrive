"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_MODELS = exports.EMBED_MODELS = exports.MODEL_SKIP = exports.MODEL_CUSTOM = void 0;
const constants_1 = require("./constants");
/** Sentinel value: user wants to enter a custom model path. */
exports.MODEL_CUSTOM = '__custom__';
/** Sentinel value: user wants to skip chat model. */
exports.MODEL_SKIP = '__skip__';
exports.EMBED_MODELS = [
    {
        id: constants_1.DEFAULT_EMBED_MODEL,
        label: 'Qwen3-Embedding-0.6B',
        size: '~600 MB',
        recommended: true,
    },
    {
        id: 'hf:unsloth/embeddinggemma-300m-GGUF',
        label: 'embeddinggemma-300M',
        size: '~300 MB',
        recommended: false,
    },
];
exports.CHAT_MODELS = [
    {
        id: constants_1.DEFAULT_CHAT_MODEL,
        label: 'Qwen3-0.6B',
        size: '~500 MB',
        recommended: true,
    },
    {
        id: 'hf:unsloth/Qwen3-1.7B-GGUF',
        label: 'Qwen3-1.7B',
        size: '~1.2 GB',
        recommended: false,
    },
    {
        id: 'hf:unsloth/Qwen3-4B-GGUF',
        label: 'Qwen3-4B',
        size: '~2.5 GB',
        recommended: false,
    },
];
//# sourceMappingURL=model-catalog.js.map