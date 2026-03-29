import type { AppConfig } from './config';
import { getEmbedConfig } from '@nomnomdrive/shared';
import { resolveModelPath } from './models';
import type { EmbedConfig } from '@nomnomdrive/shared';

export interface IEmbedder {
  initialize(onProgress?: (downloaded: number, total: number) => void): Promise<void>;
  getEmbedding(text: string): Promise<number[]>;
  getEmbeddings(texts: string[]): Promise<number[][]>;
  isReady(): boolean;
  getDims(): number;
  dispose(): Promise<void>;
}

// ── Local (GGUF via node-llama-cpp) ──────────────────────────────────────────

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

export class LocalEmbedder implements IEmbedder {
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
    const embedCfg = getEmbedConfig(this.config);
    const modelId = embedCfg.provider === 'local' ? embedCfg.model : this.config.model.localEmbed;
    this.readyPromise = (async () => {
      this.modelPath = await resolveModelPath(modelId, onProgress);

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

// ── Remote (OpenAI / OpenAI-compatible / Gemini) ──────────────────────────────

export class RemoteEmbedder implements IEmbedder {
  private dims: number | null = null;
  private ready = false;
  private readonly embedCfg: EmbedConfig & { provider: 'openai' | 'gemini' };

  constructor(embedCfg: EmbedConfig & { provider: 'openai' | 'gemini' }) {
    this.embedCfg = embedCfg;
  }

  async initialize(_onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    // Probe dims with a test call
    const vec = await this.fetchEmbedding('test');
    this.dims = vec.length;
    this.ready = true;
  }

  private async fetchEmbedding(text: string): Promise<number[]> {
    const cfg = this.embedCfg;
    if (cfg.provider === 'openai') {
      const baseUrl = cfg.baseUrl?.replace(/\/$/, '') ?? 'https://api.openai.com/v1';
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({ model: cfg.model, input: [text] }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI embeddings error ${res.status}: ${body}`);
      }
      const json = await res.json() as { data: Array<{ embedding: number[] }> };
      return json.data[0].embedding;
    } else {
      // Gemini
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:embedContent?key=${cfg.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: { parts: [{ text }] } }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini embedContent error ${res.status}: ${body}`);
      }
      const json = await res.json() as { embedding: { values: number[] } };
      return json.embedding.values;
    }
  }

  async getEmbedding(text: string): Promise<number[]> {
    if (!this.ready) throw new Error('RemoteEmbedder not initialized');
    return this.fetchEmbedding(text);
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.getEmbedding(text));
    }
    return results;
  }

  isReady(): boolean {
    return this.ready;
  }

  getDims(): number {
    if (this.dims === null) throw new Error('RemoteEmbedder not initialized');
    return this.dims;
  }

  async dispose(): Promise<void> {
    // no-op
  }
}

// ── Proxy (swappable inner embedder for hot-reload) ──────────────────────────

export class EmbedderProxy implements IEmbedder {
  private inner: IEmbedder;

  constructor(inner: IEmbedder) {
    this.inner = inner;
  }

  /** Swap the inner embedder and dispose the old one. */
  async swap(newInner: IEmbedder): Promise<void> {
    const old = this.inner;
    this.inner = newInner;
    await old.dispose();
  }

  initialize(onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    return this.inner.initialize(onProgress);
  }
  getEmbedding(text: string): Promise<number[]> {
    return this.inner.getEmbedding(text);
  }
  getEmbeddings(texts: string[]): Promise<number[][]> {
    return this.inner.getEmbeddings(texts);
  }
  isReady(): boolean {
    return this.inner.isReady();
  }
  getDims(): number {
    return this.inner.getDims();
  }
  dispose(): Promise<void> {
    return this.inner.dispose();
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createEmbedder(config: AppConfig): IEmbedder {
  const embedCfg = getEmbedConfig(config);
  if (embedCfg.provider === 'local') return new LocalEmbedder(config);
  return new RemoteEmbedder(embedCfg as EmbedConfig & { provider: 'openai' | 'gemini' });
}

// Backwards-compat alias
export { LocalEmbedder as Embedder };
