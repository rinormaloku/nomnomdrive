<script lang="ts">
  import { onMount } from 'svelte';
  import { activeTab, config, setupProgress } from '../lib/stores';
  import { nomnom } from '../lib/nomnom';
  import { renderMarkdown } from '../lib/markdown';

  type ToolCall = {
    name: string;
    params: Record<string, unknown>;
    result: string;
  };

  type Message = {
    role: 'user' | 'assistant';
    content: string;
    streaming?: boolean;
    error?: boolean;
    toolCalls?: ToolCall[];
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

  // Lazy-init when chat tab first becomes active
  let hasTriedInit = false;
  let lastChatConfigured = $config.chatConfigured;
  $: if ($config.chatConfigured !== lastChatConfigured) {
    lastChatConfigured = $config.chatConfigured;
    // Config changed (model switched in settings) — allow re-init
    hasTriedInit = false;
    initialized = false;
    loadError = '';
  }
  $: if ($activeTab === 'chat' && !initialized && !initializing && !hasTriedInit) {
    hasTriedInit = true;
    if (!$config.chatConfigured) {
      loadError = '__not_configured__';
    } else {
      doInit();
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
        messages[streamingIdx].toolCalls!.push(data);
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
    if (!text || busy || !initialized) return;

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

  async function resetChat() {
    if (busy) return;
    await nomnom.chatReset();
    messages = [];
    inputEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function formatToolParams(params: Record<string, unknown>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
  }

  function truncate(text: string, maxLen = 300): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  }

  // Need tick from svelte for DOM updates
  import { tick } from 'svelte';

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
    {#if initializing}
      <div class="chat-loading-spinner"></div>
    {/if}
    {#if chatDownloading}
      <span>Downloading chat model...</span>
      <div class="chat-progress-wrap">
        <div class="chat-progress-bar" style="width: {chatProgressPct}%"></div>
      </div>
      <span class="chat-progress-text">{chatProgressMB} / {chatTotalMB} MB ({chatProgressPct}%)</span>
    {:else}
      <span>{initializing ? 'Loading chat model...' : 'Switch to Chat tab to load model'}</span>
    {/if}
  </div>
{:else if loadError === '__not_configured__'}
  <div class="chat-empty-state">
    <span class="chat-empty-icon">
      <svg width="28" height="28" viewBox="0 0 16 16" fill="none">
        <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" stroke="#94a3b8" stroke-width="1.2" stroke-linejoin="round" />
      </svg>
    </span>
    <h3 class="chat-empty-title">Chat is not enabled</h3>
    <p class="chat-empty-desc">
      To chat with your documents, enable a chat model in Settings.
      For the best local experience, use <strong>Qwen3-8B</strong> (~5 GB).
      If you don't have the resources, use an OpenAI-compatible API instead.
    </p>
    <div class="chat-empty-actions">
      <button class="chat-empty-btn primary" onclick={() => activeTab.set('settings')}>Open Settings</button>
      <button class="chat-empty-btn secondary" onclick={() => activeTab.set('mcp')}>Learn about MCP</button>
    </div>
  </div>
{:else if loadError}
  <div class="chat-loading">
    <span>{loadError}</span>
  </div>
{:else}
  <div class="chat-container">
    <div class="chat-messages" bind:this={messagesEl}>
      {#if messages.length === 0}
        <div class="chat-welcome">
          <span class="chat-welcome-icon">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" stroke="#94a3b8" stroke-width="1.3" stroke-linejoin="round" />
              <path d="M5 5.5h6M5 8h4" stroke="#94a3b8" stroke-width="1.2" stroke-linecap="round" />
            </svg>
          </span>
          <p>Ask anything about your documents</p>
        </div>
      {/if}

      {#each messages as msg}
        {#if msg.role === 'user'}
          <div class="chat-bubble user">{msg.content}</div>
        {:else}
          <div
            class="chat-bubble assistant"
            class:streaming={msg.streaming}
            class:error={msg.error}
          >
            {#if msg.toolCalls && msg.toolCalls.length > 0}
              <div class="tool-calls">
                {#each msg.toolCalls as tc}
                  <details class="tool-call-block">
                    <summary class="tool-call-summary">
                      <span class="tool-call-icon">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <path d="M6.5 1.5l-1 3.5L2 6.5l3.5 1.5 1 3.5 1-3.5L11 6.5 7.5 5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                        </svg>
                      </span>
                      <span class="tool-call-name">{tc.name}</span>(<span class="tool-call-params">{formatToolParams(tc.params)}</span>)
                    </summary>
                    <div class="tool-call-result">
                      <pre>{truncate(tc.result)}</pre>
                    </div>
                  </details>
                {/each}
              </div>
            {/if}

            {#if msg.error}
              {msg.content}
            {:else}
              {@html renderMarkdown(msg.content.replace(/^\s+/, ''))}
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <div class="chat-input-row">
      <input
        type="text"
        class="chat-input"
        bind:value={inputValue}
        bind:this={inputEl}
        placeholder="Ask about your docs..."
        autocomplete="off"
        onkeydown={onKeydown}
      />
      <button class="chat-send-btn" disabled={busy} onclick={sendMessage} title="Send">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M2 8l5-5v3.5h5V8H7v3.5L2 8z" fill="currentColor" transform="rotate(-90 8 8)" />
        </svg>
      </button>
    </div>

    <button class="chat-reset-btn" onclick={resetChat} disabled={busy}>New Chat</button>
  </div>
{/if}

<style>
  .tool-calls {
    margin-bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tool-call-block {
    background: rgba(148, 163, 184, 0.08);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 6px;
    font-size: 0.8em;
    overflow: hidden;
  }

  .tool-call-summary {
    padding: 4px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    color: #94a3b8;
    user-select: none;
  }

  .tool-call-summary:hover {
    color: #cbd5e1;
  }

  .tool-call-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .tool-call-name {
    font-weight: 600;
    color: #a78bfa;
  }

  .tool-call-params {
    color: #94a3b8;
    font-family: monospace;
    font-size: 0.9em;
  }

  .tool-call-result {
    padding: 4px 8px 8px;
    border-top: 1px solid rgba(148, 163, 184, 0.1);
  }

  .tool-call-result pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.85em;
    color: #94a3b8;
    max-height: 200px;
    overflow-y: auto;
  }

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
    opacity: 0.4;
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
