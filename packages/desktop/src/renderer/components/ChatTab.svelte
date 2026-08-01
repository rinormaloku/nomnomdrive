<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { activeView, chatOpen, config, setupProgress, chatModelState } from '../lib/stores';
  import type { ChatModelState } from '../lib/stores';
  import { nomnom } from '../lib/nomnom';
  import { renderMarkdown } from '../lib/markdown';
  import Bot from './Bot.svelte';
  import {
    MessageSquare,
    ArrowUp,
    ChevronRight,
    Search,
    FolderTree,
    Files,
    FileText,
    Wrench,
    RotateCcw,
  } from 'lucide-svelte';

  // Shape pushed by the main process on the `chat-tool-call` event.
  type ToolCall = {
    name: string;
    params: Record<string, unknown>;
    result: string;
  };

  // Same call plus a renderer-local id, used to key each block and its UI state.
  type UiToolCall = ToolCall & { id: number };

  type Message = {
    role: 'user' | 'assistant';
    content: string;
    streaming?: boolean;
    error?: boolean;
    toolCalls?: UiToolCall[];
  };

  let initialized = false;
  let initializing = false;
  let loadError = '';
  let messages: Message[] = [];
  let inputValue = '';
  let busy = false;
  let streamingIdx = -1;
  let messagesEl: HTMLDivElement;
  let inputEl: HTMLInputElement;

  const SUGGESTIONS = ['What folders are indexed?', 'List my PDFs', "Summarize what's in my notes"];

  // "Enable Chat" one-click flow state (not-configured empty state)
  type DefaultModelStatus = { modelId: string; label: string; size: string; downloaded: boolean };
  let defaultModelStatus: DefaultModelStatus | null = null;
  let enabling = false;

  // Chat model hot-swap state (settings save / Enable Chat)
  $: reloading = $chatModelState.state === 'reloading';
  $: handleModelState($chatModelState);

  function handleModelState(s: ChatModelState) {
    if (s.state === 'ready') {
      chatModelState.set({ state: 'idle' });
      // New engine is loaded — re-run init so the session uses the new model
      initialized = false;
      hasTriedInit = false;
      loadError = '';
      enabling = false;
    } else if (s.state === 'error') {
      chatModelState.set({ state: 'idle' });
      initialized = false;
      hasTriedInit = true; // don't auto-retry a failing model
      loadError = 'Failed to load chat model: ' + (s.message ?? 'Unknown error');
      enabling = false;
    }
  }

  /** Leave the drawer so the settings screen isn't hidden behind it. */
  function goToSettings() {
    chatOpen.set(false);
    activeView.set('settings');
  }

  // Lazy-init when the chat drawer first opens
  let hasTriedInit = false;
  let lastChatConfigured = $config.chatConfigured;
  $: if ($config.chatConfigured !== lastChatConfigured) {
    lastChatConfigured = $config.chatConfigured;
    // Config changed (model switched in settings) — allow re-init
    hasTriedInit = false;
    initialized = false;
    loadError = '';
  }
  $: if ($chatOpen && !initialized && !initializing && !hasTriedInit && !reloading) {
    hasTriedInit = true;
    if (!$config.chatConfigured) {
      loadError = '__not_configured__';
    } else {
      doInit();
    }
  }

  // When the not-configured state shows, check whether the default model is already on disk
  $: if (loadError === '__not_configured__' && !defaultModelStatus) {
    nomnom
      .chatDefaultModelStatus()
      .then((s) => (defaultModelStatus = s))
      .catch(() => {});
  }

  async function enableChat() {
    if (!defaultModelStatus || enabling) return;
    enabling = true;
    try {
      // Partial update: config:save merges `model` with the existing keys, so
      // localEmbed / watch / mcp are untouched. The save triggers the normal
      // chat hot-reload path in the main process (reloading → download → ready).
      await nomnom.configSave({
        chat: { provider: 'local', model: defaultModelStatus.modelId },
        model: { localChat: defaultModelStatus.modelId },
      });
    } catch (e: unknown) {
      enabling = false;
      loadError = 'Failed to enable chat: ' + (e instanceof Error ? e.message : String(e));
    }
  }

  async function doInit() {
    initializing = true;
    try {
      await nomnom.chatInit();
      initialized = true;
      setTimeout(() => inputEl?.focus(), 0);
    } catch (e: any) {
      loadError = 'Failed to load model: ' + e.message;
    } finally {
      initializing = false;
    }
  }

  let nextToolId = 1;

  onMount(() => {
    const chunkHandler = (e: Event) => {
      const chunk = (e as CustomEvent<string>).detail;
      if (streamingIdx >= 0) {
        messages[streamingIdx].content += chunk;
        messages = messages;
        messagesEl?.scrollTo({ top: messagesEl.scrollHeight });
      }
    };

    const toolCallHandler = (e: Event) => {
      const data = (e as CustomEvent<ToolCall>).detail;
      if (streamingIdx >= 0) {
        if (!messages[streamingIdx].toolCalls) {
          messages[streamingIdx].toolCalls = [];
        }
        messages[streamingIdx].toolCalls!.push({ ...data, id: nextToolId++ });
        messages = messages;
        messagesEl?.scrollTo({ top: messagesEl.scrollHeight });
      }
    };

    window.addEventListener('chat-chunk', chunkHandler);
    window.addEventListener('chat-tool-call', toolCallHandler);
    return () => {
      window.removeEventListener('chat-chunk', chunkHandler);
      window.removeEventListener('chat-tool-call', toolCallHandler);
    };
  });

  async function sendMessage() {
    const text = inputValue.trim();
    if (!text || busy || !initialized || reloading) return;

    busy = true;
    inputValue = '';

    messages = [...messages, { role: 'user', content: text }];
    messages = [...messages, { role: 'assistant', content: '', streaming: true, toolCalls: [] }];
    streamingIdx = messages.length - 1;

    await tick();
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight });

    try {
      await nomnom.chatSend(text);
      messages[streamingIdx].streaming = false;
      messages = messages;
    } catch (e: any) {
      messages[streamingIdx].streaming = false;
      messages[streamingIdx].error = true;
      messages[streamingIdx].content = 'Error: ' + e.message;
      messages = messages;
    } finally {
      streamingIdx = -1;
      busy = false;
      setTimeout(() => inputEl?.focus(), 0);
    }
  }

  function askSuggestion(text: string) {
    if (busy || reloading) return;
    inputValue = text;
    sendMessage();
  }

  async function resetChat() {
    if (busy || reloading) return;
    await nomnom.chatReset();
    messages = [];
    chunkCache.clear();
    collapsedTools = new Set();
    expandedChunks = new Set();
    inputEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Tool call rendering ────────────────────────────────────────────────

  type Chunk = {
    n: number;
    filename: string;
    fileType: string;
    score: number | null;
    content: string;
  };

  const CHUNK_CAP = 4000; // per-chunk character cap so the DOM stays sane
  const RAW_CAP = 8000; // cap for the raw-text fallback
  const CLAMP_AT = 200; // longer snippets get a "Show more" toggle

  // `[1] boiler-manual.pdf (pdf, score: 0.913)` — the header line each
  // search_documents result block starts with.
  const CHUNK_HEAD = /^\[(\d+)\]\s+(.+?)\s+\(([^()]*?),\s*score:\s*(-?[\d.]+)\)$/;

  /**
   * Parse a search_documents result into chunk cards.
   * Returns null for anything that isn't in that exact shape (list_folders
   * output, "No relevant documents found.", errors, other tools) so the caller
   * can fall back to plain text.
   */
  function parseChunks(result: string): Chunk[] | null {
    if (typeof result !== 'string' || !result.trim()) return null;
    try {
      const blocks = result.split('\n\n---\n\n');
      const chunks: Chunk[] = [];
      for (const block of blocks) {
        const nl = block.indexOf('\n');
        const head = (nl === -1 ? block : block.slice(0, nl)).trim();
        const m = CHUNK_HEAD.exec(head);
        if (!m) return null;
        const score = Number(m[4]);
        chunks.push({
          n: Number(m[1]),
          filename: m[2],
          fileType: (m[3] ?? '').trim(),
          score: Number.isFinite(score) ? score : null,
          content: (nl === -1 ? '' : block.slice(nl + 1)).trim().slice(0, CHUNK_CAP),
        });
      }
      return chunks.length > 0 ? chunks : null;
    } catch {
      return null;
    }
  }

  const chunkCache = new Map<number, Chunk[] | null>();

  function chunksOf(tc: UiToolCall): Chunk[] | null {
    if (!chunkCache.has(tc.id)) chunkCache.set(tc.id, parseChunks(tc.result));
    return chunkCache.get(tc.id) ?? null;
  }

  function rawResult(tc: UiToolCall): string {
    const text = typeof tc.result === 'string' ? tc.result : String(tc.result ?? '');
    return text.length > RAW_CAP ? text.slice(0, RAW_CAP) + '\n…' : text;
  }

  function formatValue(v: unknown): string {
    let s: string;
    try {
      s = JSON.stringify(v) ?? String(v);
    } catch {
      s = String(v);
    }
    if (s.length > 44) {
      s = s.startsWith('"') ? s.slice(0, 41) + '…"' : s.slice(0, 41) + '…';
    }
    return s;
  }

  function formatToolParams(params: Record<string, unknown>): string {
    if (!params || typeof params !== 'object') return '{ }';
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
    if (entries.length === 0) return '{ }';
    return '{ ' + entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(', ') + ' }';
  }

  function scorePct(score: number): number {
    return Math.round(Math.max(0, Math.min(1, score)) * 100);
  }

  function isLong(text: string): boolean {
    return text.length > CLAMP_AT || text.split('\n').length > 3;
  }

  let collapsedTools = new Set<number>();
  let expandedChunks = new Set<string>();

  function toggleTool(id: number) {
    if (collapsedTools.has(id)) collapsedTools.delete(id);
    else collapsedTools.add(id);
    collapsedTools = collapsedTools;
  }

  function toggleChunk(key: string) {
    if (expandedChunks.has(key)) expandedChunks.delete(key);
    else expandedChunks.add(key);
    expandedChunks = expandedChunks;
  }

  // Download progress for chat model
  $: chatDownloading = $setupProgress.phase === 'chat' && $setupProgress.total > 0;
  $: chatProgressPct = $setupProgress.total > 0
    ? Math.floor(($setupProgress.downloaded / $setupProgress.total) * 100)
    : 0;
  $: chatProgressMB = ($setupProgress.downloaded / (1024 * 1024)).toFixed(1);
  $: chatTotalMB = ($setupProgress.total / (1024 * 1024)).toFixed(1);
</script>

{#if !initialized && !loadError}
  <div class="chat-loading">
    {#if initializing || reloading}
      <div class="chat-loading-spinner"></div>
    {/if}
    {#if chatDownloading}
      <span>Downloading chat model...</span>
      <div class="chat-progress-wrap">
        <div class="chat-progress-bar" style="width: {chatProgressPct}%"></div>
      </div>
      <span class="chat-progress-text">{chatProgressMB} / {chatTotalMB} MB ({chatProgressPct}%)</span>
    {:else if reloading}
      <span>Preparing chat model...</span>
    {:else}
      <span>{initializing ? 'Loading chat model...' : 'Open the chat drawer to load model'}</span>
    {/if}
  </div>
{:else if loadError === '__not_configured__'}
  <div class="chat-empty-state">
    <span class="chat-empty-icon">
      <MessageSquare size={28} color="#a69889" />
    </span>
    <h3 class="chat-empty-title">Chat is not enabled</h3>
    <p class="chat-empty-desc">
      Chat runs a local model against your indexed documents.
      {#if defaultModelStatus?.downloaded}
        <strong>{defaultModelStatus.label}</strong> is already downloaded — enable chat to start
        asking questions.
      {:else if defaultModelStatus}
        Enabling chat downloads <strong>{defaultModelStatus.label}</strong> ({defaultModelStatus.size})
        and runs it on this machine. Prefer another model or an OpenAI-compatible API? Pick one in
        Settings.
      {/if}
    </p>
    <div class="chat-empty-actions">
      <button
        class="chat-empty-btn primary"
        onclick={enableChat}
        disabled={enabling || !defaultModelStatus}
      >
        {#if enabling}
          Enabling...
        {:else if defaultModelStatus && !defaultModelStatus.downloaded}
          Enable Chat — downloads {defaultModelStatus.label} ({defaultModelStatus.size})
        {:else}
          Enable Chat
        {/if}
      </button>
      <button class="chat-empty-btn secondary" onclick={goToSettings}>
        Choose a different model in Settings
      </button>
    </div>
  </div>
{:else if loadError}
  <div class="chat-loading">
    <span>{loadError}</span>
  </div>
{:else}
  <div class="chat-container">
    {#if reloading}
      <div class="chat-reload-banner">
        <div class="chat-reload-row">
          <div class="chat-loading-spinner chat-reload-spinner"></div>
          <span>
            {#if chatDownloading}
              Switching chat model... downloading {chatProgressPct}% ({chatProgressMB} / {chatTotalMB} MB)
            {:else}
              Switching chat model...
            {/if}
          </span>
        </div>
        {#if chatDownloading}
          <div class="chat-progress-wrap chat-reload-progress">
            <div class="chat-progress-bar" style="width: {chatProgressPct}%"></div>
          </div>
        {/if}
      </div>
    {/if}
    <div class="chat-messages" bind:this={messagesEl}>
      {#if messages.length === 0}
        <div class="chat-hello">
          <Bot size={76} shadow blink mouth="open" />
          <h3 class="hello-title">Ask about your documents</h3>
          <p class="hello-desc">
            Answers are built from the files you've indexed. The model runs here — nothing leaves
            this machine.
          </p>
          <div class="hello-chips">
            {#each SUGGESTIONS as s}
              <button class="hello-chip" onclick={() => askSuggestion(s)} disabled={busy}>{s}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#each messages as msg}
        {#if msg.role === 'user'}
          <div class="chat-bubble user">{msg.content}</div>
        {:else}
          <div class="chat-turn">
            {#if msg.toolCalls && msg.toolCalls.length > 0}
              <div class="tool-calls">
                {#each msg.toolCalls as tc (tc.id)}
                  {@const chunks = chunksOf(tc)}
                  {@const open = !collapsedTools.has(tc.id)}
                  <div class="tool-card" class:open>
                    <button
                      class="tool-head"
                      onclick={() => toggleTool(tc.id)}
                      aria-expanded={open}
                      title={open ? 'Hide results' : 'Show results'}
                    >
                      <span class="tool-head-row">
                        <span class="tool-chev"><ChevronRight size={12} /></span>
                        <span class="tool-glyph">
                          {#if tc.name === 'search_documents'}
                            <Search size={12} />
                          {:else if tc.name === 'list_folders'}
                            <FolderTree size={12} />
                          {:else if tc.name === 'list_files'}
                            <Files size={12} />
                          {:else if tc.name === 'get_document'}
                            <FileText size={12} />
                          {:else}
                            <Wrench size={12} />
                          {/if}
                        </span>
                        <span class="tool-name">{tc.name}</span>
                        {#if chunks}
                          <span class="tool-count">
                            {chunks.length}
                            {chunks.length === 1 ? 'chunk' : 'chunks'}
                          </span>
                        {/if}
                      </span>
                      <span class="tool-meta">
                        <code class="tool-params">{formatToolParams(tc.params)}</code>
                        <span class="tool-tag">→ NomNomDrive · local</span>
                      </span>
                    </button>

                    {#if open}
                      <div class="tool-body">
                        {#if chunks}
                          {#each chunks as c, i}
                            {@const key = `${tc.id}:${i}`}
                            {@const expanded = expandedChunks.has(key)}
                            <div class="chunk-card">
                              <div class="chunk-head">
                                <span class="chunk-n">{c.n}</span>
                                <span class="chunk-file" title={c.filename}>{c.filename}</span>
                                {#if c.fileType}
                                  <span class="chunk-type">{c.fileType}</span>
                                {/if}
                                {#if c.score !== null}
                                  <span class="chunk-score" title="Relevance score">
                                    {#if c.score >= 0 && c.score <= 1}
                                      <span class="score-track">
                                        <span class="score-fill" style="width: {scorePct(c.score)}%"
                                        ></span>
                                      </span>
                                      {c.score.toFixed(3)}
                                    {:else}
                                      {c.score.toFixed(1)}
                                    {/if}
                                  </span>
                                {/if}
                              </div>
                              <p class="chunk-snip" class:clamped={!expanded}>{c.content}</p>
                              {#if isLong(c.content)}
                                <button class="chunk-more" onclick={() => toggleChunk(key)}>
                                  {expanded ? 'Show less' : 'Show more'}
                                </button>
                              {/if}
                            </div>
                          {/each}
                        {:else}
                          <pre class="tool-raw">{rawResult(tc)}</pre>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            {#if msg.error}
              <div class="chat-bubble assistant error">{msg.content}</div>
            {:else if msg.content.trim()}
              <div class="chat-bubble assistant" class:streaming={msg.streaming}>
                {@html renderMarkdown(msg.content.replace(/^\s+/, ''))}
              </div>
            {:else if msg.streaming}
              <div class="chat-bubble assistant thinking">
                <span class="typing-dots"><span></span><span></span><span></span></span>
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <div class="chat-footer">
      <div class="chat-input-row">
        <input
          type="text"
          class="chat-input"
          bind:value={inputValue}
          bind:this={inputEl}
          placeholder={reloading ? 'Switching chat model...' : 'Ask about your docs...'}
          autocomplete="off"
          disabled={reloading}
          onkeydown={onKeydown}
        />
        <button
          class="chat-send-btn"
          disabled={busy || reloading}
          onclick={sendMessage}
          title="Send"
        >
          <ArrowUp size={14} />
        </button>
      </div>
      <div class="chat-footer-actions">
        <button class="chat-reset-btn" onclick={resetChat} disabled={busy || reloading}>
          <RotateCcw size={11} />
          New chat
        </button>
        <span class="chat-hint">Enter to send</span>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Tool call card ──────────────────────────────── */

  .tool-calls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .tool-card {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border-light));
    background: linear-gradient(180deg, var(--accent-light) 0%, var(--bg2) 100%);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  .tool-head {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    min-width: 0;
    padding: 8px 10px;
    background: none;
    border: none;
    text-align: left;
    font-family: var(--font);
    cursor: pointer;
    transition: background var(--transition);
  }

  .tool-head:hover {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .tool-head:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .tool-head-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .tool-chev {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--accent);
    opacity: 0.75;
    transition: transform var(--transition);
  }

  .tool-card.open .tool-chev {
    transform: rotate(90deg);
  }

  .tool-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 19px;
    height: 19px;
    flex-shrink: 0;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 13%, transparent);
    color: var(--accent);
  }

  .tool-name {
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tool-count {
    margin-left: auto;
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--green);
    background: var(--green-light);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .tool-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 25px;
    min-width: 0;
  }

  .tool-params {
    flex: 0 1 auto;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tool-tag {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 600;
    color: var(--accent);
    background: var(--bg);
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
    border-radius: 999px;
    padding: 1px 7px;
  }

  /* ── Retrieval rail + chunk cards ────────────────── */

  .tool-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    margin: 0 10px 10px 19px;
    padding-left: 10px;
    border-left: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .chunk-card {
    min-width: 0;
    background: var(--bg);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    padding: 7px 9px;
    box-shadow: var(--shadow-sm);
  }

  .chunk-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
    min-width: 0;
  }

  .chunk-n {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 700;
    color: var(--text-dim);
    background: var(--bg3);
    border-radius: 4px;
    padding: 1px 5px;
  }

  .chunk-file {
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chunk-type {
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--text-secondary);
    background: var(--bg3);
    border-radius: 4px;
    padding: 1px 5px;
  }

  .chunk-score {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--green);
    background: var(--green-light);
    border-radius: 999px;
    padding: 2px 7px;
    font-variant-numeric: tabular-nums;
  }

  .score-track {
    width: 20px;
    height: 3px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--green) 22%, transparent);
    overflow: hidden;
  }

  .score-fill {
    display: block;
    height: 100%;
    background: var(--green);
    border-radius: 2px;
  }

  .chunk-snip {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
    -webkit-user-select: text;
  }

  .chunk-snip.clamped {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .chunk-more {
    margin-top: 4px;
    padding: 0;
    background: none;
    border: none;
    font-family: var(--font);
    font-size: 10.5px;
    font-weight: 700;
    color: var(--accent);
    cursor: pointer;
  }

  .chunk-more:hover {
    text-decoration: underline;
  }

  /* Fallback for results that aren't search chunks */
  .tool-raw {
    margin: 0;
    padding: 7px 9px;
    background: var(--bg);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 220px;
    overflow-y: auto;
    user-select: text;
    -webkit-user-select: text;
  }

  .tool-raw::-webkit-scrollbar {
    width: 5px;
  }

  .tool-raw::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 3px;
  }

  /* ── Typing indicator ────────────────────────────── */

  .typing-dots {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
  }

  .typing-dots span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    animation: chat-dot 1.1s ease-in-out infinite;
  }

  .typing-dots span:nth-child(2) {
    animation-delay: 0.16s;
  }

  .typing-dots span:nth-child(3) {
    animation-delay: 0.32s;
  }

  @keyframes chat-dot {
    0%,
    100% {
      opacity: 0.25;
      transform: translateY(0);
    }
    40% {
      opacity: 1;
      transform: translateY(-2px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .typing-dots span {
      animation: none;
      opacity: 0.5;
    }
  }

  /* ── Welcome state ───────────────────────────────── */

  .chat-hello {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    margin: auto 0;
    padding: 20px;
    align-self: center;
    max-width: 380px;
  }

  .hello-title {
    margin: 2px 0 0;
    font-size: 15px;
    font-weight: 800;
    color: var(--accent);
  }

  .hello-desc {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .hello-chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 4px;
  }

  .hello-chip {
    font-family: var(--font);
    font-size: 11.5px;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-light);
    border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
    border-radius: 999px;
    padding: 5px 12px;
    cursor: pointer;
    transition: all var(--transition);
  }

  .hello-chip:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 14%, var(--bg));
    transform: translateY(-1px);
  }

  .hello-chip:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* ── Loading / reload / not-configured states ────── */

  .chat-progress-wrap {
    width: 60%;
    height: 4px;
    background: var(--bg3);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 4px;
  }

  .chat-progress-bar {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .chat-progress-text {
    font-size: 11px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .chat-reload-banner {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .chat-reload-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .chat-reload-spinner {
    width: 12px;
    height: 12px;
    border-width: 2px;
  }

  .chat-reload-progress {
    width: 100%;
    margin-top: 0;
  }

  .chat-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 10px;
    flex: 1;
    padding: 32px 24px;
  }

  .chat-empty-icon {
    opacity: 0.5;
  }

  .chat-empty-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .chat-empty-desc {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.6;
    max-width: 340px;
    margin: 0;
  }

  .chat-empty-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }

  .chat-empty-btn {
    padding: 7px 16px;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    transition: background var(--transition);
  }

  .chat-empty-btn.primary {
    background: var(--accent);
    color: #fff;
  }

  .chat-empty-btn.primary:hover {
    background: var(--accent-hover);
  }

  .chat-empty-btn.secondary {
    background: var(--bg3);
    color: var(--text);
  }

  .chat-empty-btn.secondary:hover {
    background: var(--border);
  }
</style>
