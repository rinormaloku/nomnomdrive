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
}

/** Sentinel value: user wants to enter a custom model path. */
export const MODEL_CUSTOM = '__custom__';
/** Sentinel value: user wants to skip chat model. */
export const MODEL_SKIP = '__skip__';

export const EMBED_MODELS: ModelOption[] = [
  {
    id: DEFAULT_EMBED_MODEL,
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

export const CHAT_MODELS: ModelOption[] = [
  {
    id: 'hf:unsloth/Qwen3-8B-GGUF',
    label: 'Qwen3-8B',
    size: '~5 GB',
    recommended: true,
  },
];
