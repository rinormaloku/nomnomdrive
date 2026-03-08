export type ProgressCallback = (downloaded: number, total: number) => void;
/**
 * Resolves a model identifier to a local file path.
 * Supports:
 *   - hf:<repo>/<file>  → downloads from HuggingFace
 *   - /absolute/path    → used as-is
 *   - relative/path     → resolved from models dir
 */
export declare function resolveModelPath(modelId: string, onProgress?: ProgressCallback): Promise<string>;
/**
 * Check whether a specific model identifier has been downloaded locally.
 */
export declare function modelExists(modelId: string): Promise<boolean>;
//# sourceMappingURL=models.d.ts.map