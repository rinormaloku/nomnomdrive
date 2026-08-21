export const DEFAULT_EMBED_MODEL =
  'hf:jinaai/jina-embeddings-v5-text-small-text-matching-GGUF/v5-small-text-matching-Q8_0.gguf';
export const DEFAULT_EMBED_DIMS = 1024;
export const DEFAULT_CHAT_MODEL = 'hf:unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-Q3_K_M.gguf';
export const DEFAULT_OPENAI_EMBED_MODEL = 'text-embedding-3-small';
export const DEFAULT_GEMINI_EMBED_MODEL = 'text-embedding-004';
export const DEFAULT_MCP_PORT = 23847;
export const DEFAULT_CHUNK_SIZE = 500; // characters (~125 tokens)
export const DEFAULT_CHUNK_OVERLAP = 50; // characters

// ── Retrieval tuning ────────────────────────────────────────────────────────
// Small chunks mean a single hit is rarely a whole answer, so search merges
// adjacent hits and pads them with neighbours instead of returning bare chunks.

/** Passages returned by search_documents after adjacent hits are merged. */
export const SEARCH_MAX_PASSAGES = 8;
/** Chunk hits pulled from each retriever before merging and fusion. */
export const SEARCH_CANDIDATES = 30;
/** Neighbouring chunks added on each side of a hit to restore context. */
export const SEARCH_CONTEXT_CHUNKS = 1;
/**
 * Hard ceiling on one passage. Without it, a document where many consecutive
 * chunks match (repetitive reports, tables, boilerplate) chains into a single
 * span covering half the file — the context flood this design exists to avoid.
 * Beyond the ceiling the run is split into separate passages.
 */
export const SEARCH_MAX_PASSAGE_CHUNKS = 6;
/** Passages one document may contribute, so a single file cannot crowd out the rest. */
export const SEARCH_MAX_PASSAGES_PER_DOC = 3;
/**
 * Cosine floor for vector hits. Deliberately low — KNN always returns k rows,
 * so this only drops obvious junk, it is not a relevance threshold.
 * Keyword hits bypass it: an exact term match is meaningful at any cosine.
 */
export const SEARCH_MIN_SCORE = 0.1;
/** Rank-fusion constant (standard Reciprocal Rank Fusion damping). */
export const RRF_K = 60;

/** Files listed by list_files before the caller is asked to narrow the filter. */
export const LIST_FILES_LIMIT = 20;
/** Chunks read_document will return in one call. */
export const READ_MAX_CHUNKS = 40;
/**
 * A document this small is returned whole when no range is given — asking the
 * agent to search first would cost more tokens than just handing it over.
 */
export const READ_WHOLE_DOC_MAX_CHUNKS = 10;
/** Chunks shown as a preview when a large document is opened without a range. */
export const READ_PREVIEW_CHUNKS = 2;
/** Upper bound on a caller-supplied filter pattern, to bound regex cost. */
export const FILTER_MAX_LENGTH = 200;

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
