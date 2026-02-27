export const DEFAULT_EMBED_MODEL = 'hf:unsloth/embeddinggemma-300m-GGUF';
export const DEFAULT_EMBED_DIMS = 768;
export const DEFAULT_MCP_PORT = 23847;
export const DEFAULT_CHUNK_SIZE = 1500; // characters (~375 tokens)
export const DEFAULT_CHUNK_OVERLAP = 200; // characters

export const APP_NAME = 'nomnomdrive';

export const SUPPORTED_EXTENSIONS = [
  '.md',
  '.txt',
  '.csv',
  '.pdf',
  '.doc',
  '.docx',
  '.odt',
  '.rtf',
  '.pptx',
] as const;

export const MCP_SERVER_NAME = 'nomnomdrive';
export const MCP_SERVER_VERSION = '0.1.0';
