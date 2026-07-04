import { DEFAULT_EMBED_MODEL, DEFAULT_CHAT_MODEL } from './constants';

export interface ModelOption {
  /** Model identifier — e.g. "hf:unsloth/Qwen3-0.6B-GGUF" or the special sentinels */
  id: string;
  /** Human-readable label shown in UI / CLI prompts */
  label: string;
  /** Approximate download size */
  size: string;
  /** Whether this is the recommended default */
  recommended: boolean;
  /** Prefix prepended to search queries before embedding (asymmetric retrieval models) */
  queryPrefix?: string;
  /** Prefix prepended to document passages before embedding (asymmetric retrieval models) */
  documentPrefix?: string;
}

/** Sentinel value: user wants to enter a custom model path. */
export const MODEL_CUSTOM = '__custom__';
/** Sentinel value: user wants to skip chat model. */
export const MODEL_SKIP = '__skip__';

export const EMBED_MODELS: ModelOption[] = [
  {
    id: DEFAULT_EMBED_MODEL,
    label: 'Jina-Embeddings-v5-Nano (retrieval)',
    size: '~230 MB',
    recommended: true,
    queryPrefix: 'Query: ',
    documentPrefix: 'Document: ',
  },
  {
    id: 'hf:Qwen/Qwen3-Embedding-0.6B-GGUF',
    label: 'Qwen3-Embedding-0.6B',
    size: '~600 MB',
    recommended: false,
  },
  {
    id: 'hf:unsloth/embeddinggemma-300m-GGUF',
    label: 'embeddinggemma-300M',
    size: '~300 MB',
    recommended: false,
  },
];

export const CHAT_MODELS: ModelOption[] = [
  {
    id: DEFAULT_CHAT_MODEL,
    label: 'Gemma-3-4B-it (Q4_K_M)',
    size: '~2.5 GB',
    recommended: true,
  },
];

export interface EmbedPrefixes {
  /** Prepended to search queries before embedding. */
  query: string;
  /** Prepended to document passages before embedding. */
  document: string;
}

const NO_PREFIXES: EmbedPrefixes = { query: '', document: '' };

/**
 * Returns the asymmetric embedding prefixes required by the given model id.
 * Catalog entries declare their prefixes explicitly; for models outside the
 * catalog we fall back to family heuristics (e.g. any Jina v5 retrieval GGUF).
 */
export function getEmbedPrefixes(modelId: string): EmbedPrefixes {
  const catalogEntry = EMBED_MODELS.find((m) => m.id === modelId);
  if (catalogEntry?.queryPrefix !== undefined || catalogEntry?.documentPrefix !== undefined) {
    return {
      query: catalogEntry.queryPrefix ?? '',
      document: catalogEntry.documentPrefix ?? '',
    };
  }
  if (modelId.includes('jina-embeddings-v5')) {
    return { query: 'Query: ', document: 'Document: ' };
  }
  return NO_PREFIXES;
}
