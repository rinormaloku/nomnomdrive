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
  /**
   * Approximate resident memory in GB once loaded — the GGUF blob size plus a
   * working set (KV cache and compute buffers for chat models, activations for
   * embedders). Used by `hardware-tiers.ts` to decide what a machine can run.
   */
  runtimeGb?: number;
  /** Prefix prepended to search queries before embedding (asymmetric retrieval models) */
  queryPrefix?: string;
  /** Prefix prepended to document passages before embedding (asymmetric retrieval models) */
  documentPrefix?: string;
  /** Matryoshka truncation dimensions this model supports, largest first. Omitted if unverified. */
  supportedDims?: number[];
}

/**
 * Splits a "hf:org/repo[/file.gguf]" model id into its repo and (optional) filename.
 * Returns null for non-"hf:" ids (absolute/relative local paths).
 */
export function parseHfModelId(id: string): { repo: string; filename: string } | null {
  if (!id.startsWith('hf:')) return null;
  const parts = id.slice(3).split('/');
  if (parts.length < 2) return null;
  return { repo: `${parts[0]}/${parts[1]}`, filename: parts.slice(2).join('/') };
}

/** Sentinel value: user wants to enter a custom model path. */
export const MODEL_CUSTOM = '__custom__';
/** Sentinel value: user wants to skip chat model. */
export const MODEL_SKIP = '__skip__';

/**
 * Ordered largest-first within each family. Sizes are the actual GGUF blob sizes
 * published on HuggingFace, not nominal parameter counts — Gemma 4's E-variants
 * carry per-layer embeddings in the weights file and are much larger on disk
 * than "E2B" suggests.
 *
 * Embedding stops at 4B deliberately: headroom above that is better spent on a
 * reranker (see RERANKER_RESERVE_GB) than on a larger embedder.
 */
export const EMBED_MODELS: ModelOption[] = [
  {
    id: DEFAULT_EMBED_MODEL,
    label: 'Jina-Embeddings-v5-Small (text-matching)',
    size: '~640 MB',
    runtimeGb: 1.0,
    recommended: true,
    queryPrefix: 'Document: ',
    documentPrefix: 'Document: ',
    supportedDims: [1024, 768, 512, 256, 128, 64, 32],
  },
  {
    id: 'hf:Qwen/Qwen3-Embedding-4B-GGUF/Qwen3-Embedding-4B-Q8_0.gguf',
    label: 'Qwen3-Embedding-4B (Q8_0) — strongest local retrieval',
    size: '~4.3 GB',
    runtimeGb: 4.8,
    recommended: false,
    supportedDims: [2560, 2048, 1536, 1024, 768, 512, 256, 128, 64, 32],
  },
  {
    id: 'hf:Qwen/Qwen3-Embedding-4B-GGUF/Qwen3-Embedding-4B-Q4_K_M.gguf',
    label: 'Qwen3-Embedding-4B (Q4_K_M)',
    size: '~2.5 GB',
    runtimeGb: 3.0,
    recommended: false,
    supportedDims: [2560, 2048, 1536, 1024, 768, 512, 256, 128, 64, 32],
  },
  {
    id: 'hf:Qwen/Qwen3-Embedding-0.6B-GGUF',
    label: 'Qwen3-Embedding-0.6B',
    size: '~640 MB',
    runtimeGb: 1.0,
    recommended: false,
    supportedDims: [1024, 768, 512, 256, 128, 64, 32],
  },
  {
    id: 'hf:jinaai/jina-embeddings-v5-text-small-text-matching-GGUF/v5-small-text-matching-Q4_K_M.gguf',
    label: 'Jina-Embeddings-v5-Small (Q4_K_M) — smallest good option',
    size: '~400 MB',
    runtimeGb: 0.8,
    recommended: false,
    queryPrefix: 'Document: ',
    documentPrefix: 'Document: ',
    supportedDims: [1024, 768, 512, 256, 128, 64, 32],
  },
  {
    id: 'hf:unsloth/embeddinggemma-300m-GGUF',
    label: 'embeddinggemma-300M',
    size: '~330 MB',
    runtimeGb: 0.7,
    recommended: false,
    supportedDims: [768, 512, 256, 128],
  },
];

/**
 * `runtimeGb` budgets roughly 1.3 GB above the blob for KV cache and compute
 * buffers at the context sizes `chat-engine.ts` negotiates; the heavily
 * quantised entry assumes the engine settles on a smaller context.
 *
 * Tool-calling accuracy is the number that matters for this app — every answer
 * is produced by calling `search_documents` — and it separates these models far
 * more than their general benchmarks do (Tau2: E2B 24.5%, E4B 42.2%, 12B 69.0%).
 */
export const CHAT_MODELS: ModelOption[] = [
  {
    id: DEFAULT_CHAT_MODEL,
    label: 'Gemma-4-E2B-it (Q3_K_M)',
    size: '~2.5 GB',
    runtimeGb: 3.8,
    recommended: true,
  },
  {
    id: 'hf:unsloth/gemma-4-12b-it-GGUF/gemma-4-12b-it-Q4_K_M.gguf',
    label: 'Gemma-4-12B-it (Q4_K_M) — best local tool calling',
    size: '~7.1 GB',
    runtimeGb: 8.7,
    recommended: false,
  },
  {
    id: 'hf:unsloth/gemma-4-E4B-it-GGUF/gemma-4-E4B-it-Q4_K_M.gguf',
    label: 'Gemma-4-E4B-it (Q4_K_M)',
    size: '~5.0 GB',
    runtimeGb: 6.4,
    recommended: false,
  },
  {
    id: 'hf:unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-UD-Q2_K_XL.gguf',
    label: 'Gemma-4-E2B-it (UD-Q2_K_XL) — for tight memory',
    size: '~2.4 GB',
    runtimeGb: 3.2,
    recommended: false,
  },
  {
    id: 'hf:unsloth/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf',
    label: 'Qwen3-8B (Q4_K_M)',
    size: '~4.7 GB',
    runtimeGb: 6.1,
    recommended: false,
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
