import type { AppConfig } from './config';
import { resolveModelPath } from './models';

// node-llama-cpp types (dynamic import for ESM compatibility)
type LlamaContext = {
  getEmbeddingFor(text: string): Promise<{ vector: number[] }>;
  dispose(): Promise<void>;
};
type LlamaModel = {
  createEmbeddingContext(): Promise<LlamaContext>;
  dispose(): Promise<void>;
};
type Llama = {
  loadModel(opts: { modelPath: string }): Promise<LlamaModel>;
  dispose(): Promise<void>;
};

export class Embedder {
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private modelPath: string | null = null;
  private dims: number | null = null;
  private readonly config: AppConfig;
  /** Resolves when the model is ready; null if initialize() has not been called. */
  private readyPromise: Promise<void> | null = null;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async initialize(onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    this.readyPromise = (async () => {
      this.modelPath = await resolveModelPath(this.config.model.localEmbed, onProgress);

      // Use native runtime import so CommonJS transpilation does not rewrite to require()
      const { getLlama } = await (0, eval)('import("node-llama-cpp")');
      this.llama = (await getLlama()) as unknown as Llama;
      this.model = await this.llama.loadModel({ modelPath: this.modelPath });
      this.context = await this.model.createEmbeddingContext();
      // Probe actual output dims so callers can validate against the DB schema
      const probe = await this.context.getEmbeddingFor('test');
      this.dims = probe.vector.length;
    })();
    return this.readyPromise;
  }

  async getEmbedding(text: string): Promise<number[]> {
    // If the model is still loading, wait for it instead of failing immediately.
    if (!this.context) {
      if (!this.readyPromise) throw new Error('Embedder not initialized');
      await this.readyPromise;
    }
    const result = await this.context!.getEmbeddingFor(text);
    return Array.from(result.vector);
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.getEmbedding(text));
    }
    return results;
  }

  isReady(): boolean {
    return this.context !== null;
  }

  /** Returns the embedding dimension of the loaded model. Throws if not yet initialized. */
  getDims(): number {
    if (this.dims === null) throw new Error('Embedder not initialized');
    return this.dims;
  }

  getModelPath(): string | null {
    return this.modelPath;
  }

  async dispose(): Promise<void> {
    await this.context?.dispose();
    await this.model?.dispose();
    await this.llama?.dispose();
    this.context = null;
    this.model = null;
    this.llama = null;
  }
}
