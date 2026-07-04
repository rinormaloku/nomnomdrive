export const DEFAULT_EMBED_MODEL =
  'hf:jinaai/jina-embeddings-v5-text-nano-retrieval-GGUF/v5-nano-retrieval-Q8_0.gguf';
export const DEFAULT_EMBED_DIMS = 768;
export const DEFAULT_CHAT_MODEL = 'hf:unsloth/gemma-3-4b-it-GGUF/gemma-3-4b-it-Q4_K_M.gguf';
export const DEFAULT_OPENAI_EMBED_MODEL = 'text-embedding-3-small';
export const DEFAULT_GEMINI_EMBED_MODEL = 'text-embedding-004';
export const DEFAULT_MCP_PORT = 23847;
export const DEFAULT_CHUNK_SIZE = 1500; // characters (~375 tokens)
export const DEFAULT_CHUNK_OVERLAP = 100; // characters

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
