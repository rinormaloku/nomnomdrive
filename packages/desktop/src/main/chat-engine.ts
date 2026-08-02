import { type AppConfig, type ChatConfig, getChatConfig } from './config';
import type { IEmbedder } from './embedder';
import type { Store } from './store';
import { resolveModelPath } from './models';
import { getInstalledGpuType } from './gpu-manager';
import { executeSearchDocuments } from './mcp/tools/handlers';
import { CHAT_TOOLS } from './chat-tools';

// node-llama-cpp types (dynamic import for ESM compatibility)
type LlamaChatSession = {
  prompt(text: string, opts?: { onTextChunk?: (chunk: string) => void }): Promise<string>;
  promptWithMeta(
    text: string,
    opts?: {
      functions?: Record<string, unknown>;
      onTextChunk?: (chunk: string) => void;
    },
  ): Promise<{ responseText: string }>;
  dispose(): void;
};
type LlamaContext = {
  contextSize: number;
  getSequence(): unknown;
  dispose(): Promise<void>;
};
type LlamaModel = {
  createContext(opts?: {
    contextSize?: 'auto' | number | { min?: number; max?: number };
    ignoreMemorySafetyChecks?: boolean;
  }): Promise<LlamaContext>;
  dispose(): Promise<void>;
};

export type ToolCallEvent = {
  name: string;
  params: Record<string, unknown>;
  result: string;
};

// ── IChatEngine interface ─────────────────────────────────────────────────────

export interface IChatEngine {
  isConfigured(): boolean;
  initialize(onProgress?: (downloaded: number, total: number) => void): Promise<void>;
  chat(query: string, onChunk?: (text: string) => void, onToolCall?: (e: ToolCallEvent) => void): Promise<string>;
  resetSession(): Promise<void>;
  isReady(): boolean;
  dispose(): Promise<void>;
}

// ── Shared constants ──────────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `/no_think
You are a document assistant. The user's files are indexed and searchable via your tools:
- search_documents: find passages by meaning and keyword; returns file names and chunk numbers
- list_files: see which files and folders are indexed
- read_document: read a file by chunk range, using chunk numbers from search_documents
ALWAYS use tools before answering — search_documents for content questions, list_files for "what do I have" questions, read_document when you need more text around a hit. Never say you lack access. Cite filenames in answers.`;

const RAG_SYSTEM_PROMPT = `/no_think
You are a helpful assistant that answers questions based on the user's documents. Use ONLY the provided context to answer. If the context doesn't contain relevant information, say so. Be concise and cite document names.`;

/**
 * Tool results are passed through verbatim — to the model and to the UI alike.
 *
 * An earlier character cap (1500 local / 8000 remote) predates the current
 * tools, which bound their own output by design: search_documents returns at
 * most a fixed number of passages with a per-passage width ceiling, and
 * read_document caps its range. Cutting that again by character count sliced
 * through the middle of a passage and dropped the trailing instruction telling
 * the agent what to call next — so the model saw one partial result and no way
 * forward. Keeping the output identical also means what the UI shows is exactly
 * what the agent received, which is what makes the tool panel useful for
 * judging how an agent would behave.
 */

// ── LocalChatEngine (existing GGUF-based engine) ──────────────────────────────

export class LocalChatEngine implements IChatEngine {
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private session: LlamaChatSession | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly config: AppConfig;
  private readonly embedder: IEmbedder;
  private readonly store: Store;
  private defineFn!: (def: { description?: string; params?: unknown; handler: (params: any) => any }) => unknown;
  // Agent (function-calling) mode is the default; we drop to RAG mode only if
  // the loaded model turns out not to support function calling at runtime.
  private useAgentMode = true;
  private contextSize = 8192;

  constructor(config: AppConfig, embedder: IEmbedder, store: Store) {
    this.config = config;
    this.embedder = embedder;
    this.store = store;
  }

  isConfigured(): boolean {
    return !!this.config.model.localChat;
  }

  async initialize(onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    if (this.session) return;
    if (this.initPromise) return this.initPromise;

    if (!this.config.model.localChat) {
      throw new Error('No chat model configured. Run `nomnomdrive init` to set one up.');
    }

    this.initPromise = (async () => {
      const modelPath = await resolveModelPath(this.config.model.localChat, onProgress);

      const systemPrompt = this.useAgentMode ? AGENT_SYSTEM_PROMPT : RAG_SYSTEM_PROMPT;
      console.log(`[ChatEngine] Mode: ${this.useAgentMode ? 'agent (function-calling)' : 'RAG (context-stuffing)'} for ${modelPath}`);

      const { getLlama, LlamaChatSession: Session, defineChatSessionFunction } = await (0, eval)('import("node-llama-cpp")');
      const installedGpu = getInstalledGpuType();
      // Try user's chosen GPU backend, fall back to auto-detect if incompatible
      let llama;
      if (installedGpu) {
        try {
          llama = await getLlama({ gpu: installedGpu });
        } catch (err) {
          console.warn(`[ChatEngine] ${installedGpu} backend failed, falling back to auto: ${err}`);
        }
      }
      if (!llama) {
        llama = await getLlama();
      }
      const gpuBackend = (llama as { gpu: string | false }).gpu;
      console.log(`[ChatEngine] GPU backend: ${gpuBackend || 'CPU'}`);
      // Try loading with full GPU offload first, then progressively fewer GPU layers
      const gpuLayerOptions = [Infinity, 20, 10, 0];
      const chatCfg = getChatConfig(this.config);
      const configuredSize = chatCfg.provider === 'local' ? chatCfg.contextSize : undefined;
      // First attempt: user-configured size, or auto-size to available memory
      // (node-llama-cpp picks the largest context that fits, capped at 32k).
      // Fallbacks: fixed ladder with memory safety checks disabled.
      const contextAttempts: Array<{
        contextSize: number | { min?: number; max?: number };
        ignoreMemorySafetyChecks?: boolean;
      }> = configuredSize
        ? [{ contextSize: configuredSize, ignoreMemorySafetyChecks: true }]
        : [{ contextSize: { min: 2048, max: 32768 } }];
      for (const size of [8192, 4096, 2048]) {
        if (size !== configuredSize) {
          contextAttempts.push({ contextSize: size, ignoreMemorySafetyChecks: true });
        }
      }
      let loaded = false;

      for (const gpuLayers of gpuLayerOptions) {
        try {
          this.model = await (llama as { loadModel(opts: { modelPath: string; gpuLayers?: number }): Promise<LlamaModel> }).loadModel({ modelPath, gpuLayers });
          console.log(`[ChatEngine] Model loaded with gpuLayers=${gpuLayers}`);

          for (const attempt of contextAttempts) {
            try {
              this.context = await this.model.createContext(attempt);
              this.contextSize = this.context.contextSize;
              console.log(`[ChatEngine] Context created with size ${this.contextSize}`);
              loaded = true;
              break;
            } catch {
              console.warn(`[ChatEngine] Context ${JSON.stringify(attempt.contextSize)} failed with gpuLayers=${gpuLayers}, trying smaller...`);
            }
          }
          if (loaded) break;

          // All context sizes failed at this GPU layer count — dispose model and try fewer layers
          await this.model.dispose?.();
          this.model = null as unknown as LlamaModel;
        } catch (err) {
          console.warn(`[ChatEngine] Model load failed with gpuLayers=${gpuLayers}: ${err}`);
        }
      }
      if (!loaded) throw new Error('Failed to create context at any size/GPU combination');
      this.defineFn = defineChatSessionFunction;
      this.session = new (Session as new (opts: { contextSequence: unknown; systemPrompt: string }) => LlamaChatSession)({
        contextSequence: this.context!.getSequence(),
        systemPrompt: systemPrompt,
      });
    })();

    try {
      return await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }

  private buildFunctions(onToolCall?: (event: ToolCallEvent) => void) {
    const { store, embedder, defineFn } = this;
    const functions: Record<string, unknown> = {};

    for (const tool of CHAT_TOOLS) {
      const hasParams = Object.keys(tool.parameters.properties).length > 0;
      functions[tool.name] = defineFn({
        description: tool.description,
        ...(hasParams ? { params: tool.parameters } : {}),
        async handler(params: Record<string, unknown> | undefined) {
          const args = params ?? {};
          let text: string;
          try {
            text = await tool.execute(store, embedder, args);
          } catch (err: unknown) {
            text = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
          onToolCall?.({ name: tool.name, params: args, result: text });
          return text;
        },
      });
    }

    return functions;
  }

  async chat(
    query: string,
    onChunk?: (text: string) => void,
    onToolCall?: (event: ToolCallEvent) => void,
  ): Promise<string> {
    if (!this.session) {
      if (!this.initPromise) throw new Error('ChatEngine not initialized');
      await this.initPromise;
    }

    if (this.useAgentMode) {
      return this.chatAgent(query, onChunk, onToolCall);
    }
    return this.chatRAG(query, onChunk, onToolCall);
  }

  /** Agent mode: let the model decide which tools to call via function-calling. */
  private async chatAgent(
    query: string,
    onChunk?: (text: string) => void,
    onToolCall?: (event: ToolCallEvent) => void,
  ): Promise<string> {
    const functions = this.buildFunctions(onToolCall);

    try {
      const { responseText } = await this.session!.promptWithMeta(query, {
        functions,
        onTextChunk: onChunk,
      });
      return responseText;
    } catch (err) {
      // Some models/chat templates don't support function calling at all —
      // permanently drop to RAG mode for this engine and retry the query.
      console.warn(`[ChatEngine] Function calling failed, falling back to RAG mode: ${err}`);
      this.useAgentMode = false;
      await this.resetSession();
      return this.chatRAG(query, onChunk, onToolCall);
    }
  }

  /** RAG mode: pre-fetch context via search, stuff it into the prompt. */
  private async chatRAG(
    query: string,
    onChunk?: (text: string) => void,
    onToolCall?: (event: ToolCallEvent) => void,
  ): Promise<string> {
    // Search for relevant documents
    const searchResult = await executeSearchDocuments(this.store, this.embedder, { query });
    const context = searchResult.content[0].text;

    // Emit a synthetic tool-call event so the UI shows what happened
    onToolCall?.({ name: 'search_documents', params: { query }, result: context });

    // Build augmented prompt with retrieved context
    let augmented: string;
    if (!context.startsWith('No matches for')) {
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

    this.context = await this.model.createContext({ contextSize: this.contextSize, ignoreMemorySafetyChecks: true });

    const systemPrompt = this.useAgentMode ? AGENT_SYSTEM_PROMPT : RAG_SYSTEM_PROMPT;
    const { LlamaChatSession: Session } = await (0, eval)('import("node-llama-cpp")');
    this.session = new (Session as new (opts: { contextSequence: unknown; systemPrompt: string }) => LlamaChatSession)({
      contextSequence: this.context.getSequence(),
      systemPrompt: systemPrompt,
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

// ── RemoteChatEngine (OpenAI-compatible API) ──────────────────────────────────

/** OpenAI tool definition format */
type OaiTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/** OpenAI message format */
type OaiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

const REMOTE_TOOLS: OaiTool[] = CHAT_TOOLS.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

const MAX_TOOL_ITERATIONS = 10;

export class RemoteChatEngine implements IChatEngine {
  private messages: OaiMessage[] = [];
  private readonly chatCfg: ChatConfig & { provider: 'openai' };
  private readonly store: Store;
  private readonly embedder: IEmbedder;
  private abortController: AbortController | null = null;

  constructor(chatCfg: ChatConfig & { provider: 'openai' }, store: Store, embedder: IEmbedder) {
    this.chatCfg = chatCfg;
    this.store = store;
    this.embedder = embedder;
  }

  isConfigured(): boolean {
    return !!this.chatCfg.model && !!this.chatCfg.apiKey;
  }

  async initialize(_onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    // No-op for remote — no model to download
    this.messages = [{ role: 'system', content: AGENT_SYSTEM_PROMPT }];
  }

  isReady(): boolean {
    return this.messages.length > 0;
  }

  async chat(
    query: string,
    onChunk?: (text: string) => void,
    onToolCall?: (event: ToolCallEvent) => void,
  ): Promise<string> {
    if (!this.isReady()) {
      await this.initialize();
    }

    this.messages.push({ role: 'user', content: query });

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      this.abortController = new AbortController();

      const baseUrl = this.chatCfg.baseUrl?.replace(/\/$/, '') ?? 'https://api.openai.com/v1';
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.chatCfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.chatCfg.model,
          messages: this.messages,
          tools: REMOTE_TOOLS,
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Chat API error ${res.status}: ${body}`);
      }

      const { text, toolCalls } = await this.parseSSEStream(res.body!, onChunk);

      if (toolCalls.length > 0) {
        // Push assistant message with tool calls
        this.messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        // Execute each tool call and add results
        for (const tc of toolCalls) {
          let result: string;
          try {
            result = await this.executeTool(tc.name, tc.arguments);
          } catch (err: unknown) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
          onToolCall?.({ name: tc.name, params: this.safeParseJson(tc.arguments), result });
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
        // Loop back for next completion
        continue;
      }

      // Text-only response — done
      this.messages.push({ role: 'assistant', content: text });
      return text;
    }

    // Exceeded max iterations
    const fallback = 'I reached the maximum number of tool calls. Here is what I found so far.';
    this.messages.push({ role: 'assistant', content: fallback });
    return fallback;
  }

  private async parseSSEStream(
    body: ReadableStream<Uint8Array>,
    onChunk?: (text: string) => void,
  ): Promise<{ text: string; toolCalls: Array<{ id: string; name: string; arguments: string }> }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // skip malformed chunks (lenient for Ollama/LM Studio)
          }

          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            text += delta.content;
            onChunk?.(delta.content);
          }

          // Tool call deltas
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap.has(idx)) {
                toolCallMap.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' });
              }
              const entry = toolCallMap.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name = tc.function.name;
              if (tc.function?.arguments) entry.arguments += tc.function.arguments;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls = [...toolCallMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v);

    return { text, toolCalls };
  }

  private async executeTool(name: string, argsJson: string): Promise<string> {
    const args = this.safeParseJson(argsJson);
    const tool = CHAT_TOOLS.find((t) => t.name === name);
    if (!tool) return `Unknown tool: ${name}`;
    return tool.execute(this.store, this.embedder, args);
  }

  private safeParseJson(json: string): Record<string, unknown> {
    try {
      return JSON.parse(json);
    } catch {
      return {};
    }
  }

  async resetSession(): Promise<void> {
    this.messages = [{ role: 'system', content: AGENT_SYSTEM_PROMPT }];
  }

  async dispose(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    this.messages = [];
  }
}

// ── ChatEngineProxy (hot-reloadable wrapper) ──────────────────────────────────

export class ChatEngineProxy implements IChatEngine {
  private inner: IChatEngine;

  constructor(inner: IChatEngine) {
    this.inner = inner;
  }

  /** Swap the inner engine and dispose the old one. */
  async swap(newInner: IChatEngine): Promise<void> {
    const old = this.inner;
    this.inner = newInner;
    await old.dispose();
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }
  initialize(onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    return this.inner.initialize(onProgress);
  }
  chat(query: string, onChunk?: (text: string) => void, onToolCall?: (e: ToolCallEvent) => void): Promise<string> {
    return this.inner.chat(query, onChunk, onToolCall);
  }
  resetSession(): Promise<void> {
    return this.inner.resetSession();
  }
  isReady(): boolean {
    return this.inner.isReady();
  }
  dispose(): Promise<void> {
    return this.inner.dispose();
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createChatEngine(config: AppConfig, embedder: IEmbedder, store: Store): IChatEngine {
  const chatCfg = getChatConfig(config);
  if (chatCfg.provider === 'openai') {
    return new RemoteChatEngine(chatCfg, store, embedder);
  }
  return new LocalChatEngine(config, embedder, store);
}

// Backwards-compat alias
export { LocalChatEngine as ChatEngine };
