import type { AppConfig } from './config';
import type { Embedder } from './embedder';
import type { Store } from './store';
import { resolveModelPath } from './models';

// node-llama-cpp types (dynamic import for ESM compatibility)
type LlamaChatSession = {
  prompt(text: string, opts?: { onTextChunk?: (chunk: string) => void }): Promise<string>;
  dispose(): void;
};
type LlamaContext = {
  getSequence(): unknown;
  dispose(): Promise<void>;
};
type LlamaModel = {
  createContext(): Promise<LlamaContext>;
  dispose(): Promise<void>;
};

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions based on the user's documents. Use ONLY the provided context to answer. If the context doesn't contain relevant information, say so. Be concise.`;

export class ChatEngine {
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private session: LlamaChatSession | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly config: AppConfig;
  private readonly embedder: Embedder;
  private readonly store: Store;

  constructor(config: AppConfig, embedder: Embedder, store: Store) {
    this.config = config;
    this.embedder = embedder;
    this.store = store;
  }

  isConfigured(): boolean {
    return !!this.config.model.localChat;
  }

  async initialize(onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    if (this.initPromise) return this.initPromise;
    if (!this.config.model.localChat) {
      throw new Error('No chat model configured. Run `nomnomdrive init` to set one up.');
    }

    this.initPromise = (async () => {
      const modelPath = await resolveModelPath(this.config.model.localChat, onProgress);

      const { getLlama, LlamaChatSession: Session } = await (0, eval)('import("node-llama-cpp")');
      const llama = await getLlama();
      this.model = await (llama as { loadModel(opts: { modelPath: string }): Promise<LlamaModel> }).loadModel({ modelPath });
      this.context = await this.model.createContext();
      this.session = new (Session as new (opts: { contextSequence: unknown; systemPrompt: string }) => LlamaChatSession)({
        contextSequence: this.context.getSequence(),
        systemPrompt: SYSTEM_PROMPT,
      });
    })();

    return this.initPromise;
  }

  async chat(query: string, onChunk?: (text: string) => void): Promise<string> {
    if (!this.session) {
      if (!this.initPromise) throw new Error('ChatEngine not initialized');
      await this.initPromise;
    }

    // RAG: retrieve relevant chunks
    const vec = await this.embedder.getEmbedding(query);
    const results = await this.store.searchSimilar(vec, 5);

    // Build augmented prompt with context
    let augmented: string;
    if (results.length > 0) {
      const context = results
        .map((r, i) => `[${i + 1}] ${r.filename} (score: ${r.score.toFixed(3)})\n${r.content}`)
        .join('\n\n---\n\n');
      augmented = `Context from documents:\n\n${context}\n\n---\n\nQuestion: ${query}`;
    } else {
      augmented = query;
    }

    const response = await this.session!.prompt(augmented, {
      onTextChunk: onChunk,
    });

    return response;
  }

  async resetSession(): Promise<void> {
    if (!this.model) return;

    this.session?.dispose();
    await this.context?.dispose();

    this.context = await this.model.createContext();

    const { LlamaChatSession: Session } = await (0, eval)('import("node-llama-cpp")');
    this.session = new (Session as new (opts: { contextSequence: unknown; systemPrompt: string }) => LlamaChatSession)({
      contextSequence: this.context.getSequence(),
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  isReady(): boolean {
    return this.session !== null;
  }

  async dispose(): Promise<void> {
    this.session?.dispose();
    await this.context?.dispose();
    await this.model?.dispose();
    this.session = null;
    this.context = null;
    this.model = null;
    this.initPromise = null;
  }
}
