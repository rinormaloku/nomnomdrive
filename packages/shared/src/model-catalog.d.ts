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
export declare const MODEL_CUSTOM = "__custom__";
/** Sentinel value: user wants to skip chat model. */
export declare const MODEL_SKIP = "__skip__";
export declare const EMBED_MODELS: ModelOption[];
export declare const CHAT_MODELS: ModelOption[];
//# sourceMappingURL=model-catalog.d.ts.map