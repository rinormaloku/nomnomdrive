import type { AppConfig } from './config';
import { getEmbedConfig, getEmbedPrefixes } from '@nomnomdrive/shared';
import { resolveModelPath } from './models';
import type { EmbedConfig, EmbedPrefixes } from '@nomnomdrive/shared';
import { getInstalledGpuType } from './gpu-manager';

export interface IEmbedder {
  initialize(onProgress?: (downloaded: number, total: number) => void): Promise<void>;
  /** Embed a document passage (applies the model's document prefix, if any). */
  getEmbedding(text: string): Promise<number[]>;
  /** Embed document passages (applies the model's document prefix, if any). */
  getEmbeddings(texts: string[]): Promise<number[][]>;
  /** Embed a search query (applies the model's query prefix, if any). */
  embedQuery(text: string): Promise<number[]>;
  isReady(): boolean;
  getDims(): number;
  /** Returns the active GPU backend ('metal', 'cuda', 'vulkan') or false for CPU. */
  getGpuBackend(): string | false;
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
  gpu: string | false;
};

export class LocalEmbedder implements IEmbedder {
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private modelPath: string | null = null;
  private dims: number | null = null;
  private gpuBackend: string | false = false;
  private readonly config: AppConfig;
  /** Asymmetric retrieval prefixes required by the configured model (empty for most models). */
  private readonly prefixes: EmbedPrefixes;
  /** Resolves when the model is ready; null if initialize() has not been called. */
  private readyPromise: Promise<void> | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    this.prefixes = getEmbedPrefixes(this.resolveModelId());
  }

  private resolveModelId(): string {
    const embedCfg = getEmbedConfig(this.config);
    return embedCfg.provider === 'local' ? embedCfg.model : this.config.model.localEmbed;
  }

  async initialize(onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    const modelId = this.resolveModelId();
    this.readyPromise = (async () => {
      this.modelPath = await resolveModelPath(modelId, onProgress);

      // Use native runtime import so CommonJS transpilation does not rewrite to require()
      const { getLlama } = await (0, eval)('import("node-llama-cpp")');
      const installedGpu = getInstalledGpuType();
      // Try the user's chosen GPU backend, fall back to auto-detect if incompatible
      let llama: Llama | null = null;
      if (installedGpu) {
        try {
          llama = (await getLlama({ gpu: installedGpu })) as unknown as Llama;
        } catch (err) {
          console.warn(`[Embedder] ${installedGpu} backend failed, falling back to auto: ${err}`);
        }
      }
      if (!llama) {
        llama = (await getLlama()) as unknown as Llama;
      }
      this.llama = llama;
      this.gpuBackend = this.llama.gpu;
      console.log(`[Embedder] GPU backend: ${this.gpuBackend || 'CPU'}`);
      this.model = await this.llama.loadModel({ modelPath: this.modelPath });
      this.context = await this.model.createEmbeddingContext();
      // Probe actual output dims so callers can validate against the DB schema.
      // Use the document-prefixed path so the probe matches real usage.
      const probe = await this.context.getEmbeddingFor(this.prefixes.document + 'test');
      this.dims = probe.vector.length;
    })();
    return this.readyPromise;
  }

  private async embedRaw(text: string): Promise<number[]> {
    // If the model is still loading, wait for it instead of failing immediately.
    if (!this.context) {
      if (!this.readyPromise) throw new Error('Embedder not initialized');
      await this.readyPromise;
    }
    const result = await this.context!.getEmbeddingFor(text);
    return Array.from(result.vector);
  }

  async getEmbedding(text: string): Promise<number[]> {
    return this.embedRaw(this.prefixes.document + text);
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.getEmbedding(text));
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embedRaw(this.prefixes.query + text);
  }

  isReady(): boolean {
    return this.context !== null;
  }

  getDims(): number {
    if (this.dims === null) throw new Error('Embedder not initialized');
    return this.dims;
  }

  getGpuBackend(): string | false {
    return this.gpuBackend;
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

  async embedQuery(text: string): Promise<number[]> {
    // Remote embedding models are symmetric — no query/document prefixes.
    return this.getEmbedding(text);
  }

  isReady(): boolean {
    return this.ready;
  }

  getDims(): number {
    if (this.dims === null) throw new Error('RemoteEmbedder not initialized');
    return this.dims;
  }

  getGpuBackend(): string | false {
    return false; // remote embedders don't use a local GPU
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
  embedQuery(text: string): Promise<number[]> {
    return this.inner.embedQuery(text);
  }
  isReady(): boolean {
    return this.inner.isReady();
  }
  getDims(): number {
    return this.inner.getDims();
  }
  getGpuBackend(): string | false {
    return this.inner.getGpuBackend();
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
