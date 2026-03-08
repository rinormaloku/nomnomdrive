"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCP_SERVER_VERSION = exports.MCP_SERVER_NAME = exports.SUPPORTED_EXTENSIONS = exports.APP_NAME = exports.DEFAULT_CHUNK_OVERLAP = exports.DEFAULT_CHUNK_SIZE = exports.DEFAULT_MCP_PORT = exports.DEFAULT_CHAT_MODEL = exports.DEFAULT_EMBED_DIMS = exports.DEFAULT_EMBED_MODEL = void 0;
exports.DEFAULT_EMBED_MODEL = 'hf:Qwen/Qwen3-Embedding-0.6B-GGUF';
exports.DEFAULT_EMBED_DIMS = 768;
exports.DEFAULT_CHAT_MODEL = 'hf:unsloth/Qwen3-0.6B-GGUF';
exports.DEFAULT_MCP_PORT = 23847;
exports.DEFAULT_CHUNK_SIZE = 1500; // characters (~375 tokens)
exports.DEFAULT_CHUNK_OVERLAP = 100; // characters
exports.APP_NAME = 'nomnomdrive';
exports.SUPPORTED_EXTENSIONS = [
    '.md',
    '.txt',
    '.csv',
    '.pdf',
    '.doc',
    '.docx',
    '.odt',
    '.rtf',
    '.pptx',
];
exports.MCP_SERVER_NAME = 'nomnomdrive';
exports.MCP_SERVER_VERSION = '0.1.0';
//# sourceMappingURL=constants.js.map