<script lang="ts">
  import { onMount } from 'svelte';
  import { activeTab, config } from '../lib/stores';
  import { nomnom } from '../lib/nomnom';
  import { renderMarkdown } from '../lib/markdown';

  type Message = {
    role: 'user' | 'assistant';
    content: string;
    streaming?: boolean;
    error?: boolean;
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
  $: if ($activeTab === 'chat' && !initialized && !initializing && !hasTriedInit) {
    hasTriedInit = true;
    if (!$config.chatConfigured) {
      loadError = 'No chat model configured. Run `nomnomdrive init` to set one up.';
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
    const handler = (e: Event) => {
      const chunk = (e as CustomEvent<string>).detail;
      if (streamingIdx >= 0) {
        messages[streamingIdx].content += chunk;
        messages = messages;
        messagesEl?.scrollTo({ top: messagesEl.scrollHeight });
      }
    };
    window.addEventListener('chat-chunk', handler);
    return () => window.removeEventListener('chat-chunk', handler);
  });

  async function sendMessage() {
    const text = inputValue.trim();
    if (!text || busy || !initialized) return;

    busy = true;
    inputValue = '';

    messages = [...messages, { role: 'user', content: text }];
    messages = [...messages, { role: 'assistant', content: '', streaming: true }];
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

  // Need tick from svelte for DOM updates
  import { tick } from 'svelte';
</script>

{#if !initialized && !loadError}
  <div class="chat-loading">
    {#if initializing}
      <div class="chat-loading-spinner"></div>
    {/if}
    <span>{initializing ? 'Loading chat model...' : 'Switch to Chat tab to load model'}</span>
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
            {#if msg.error}
              {msg.content}
            {:else}
              {@html renderMarkdown(msg.content)}
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
