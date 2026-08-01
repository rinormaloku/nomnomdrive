<script lang="ts">
  import { chatOpen } from '../lib/stores';
  import ChatTab from './ChatTab.svelte';
  import Bot from './Bot.svelte';
  import { RotateCcw, X } from 'lucide-svelte';

  let chatTab = $state<{ resetChat: () => Promise<void> }>();

  function close() {
    chatOpen.set(false);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && $chatOpen) close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<button
  class="chat-backdrop"
  class:open={$chatOpen}
  aria-label="Close chat"
  tabindex={$chatOpen ? 0 : -1}
  onclick={close}
></button>

<aside class="chat-drawer" class:open={$chatOpen} inert={!$chatOpen}>
  <div class="chat-drawer-header">
    <span class="chat-drawer-bot">
      <Bot size={26} blink />
    </span>
    <div class="chat-drawer-title-group">
      <span class="chat-drawer-title">Test your index</span>
      <span class="chat-drawer-sub">Ask a question to check what got indexed</span>
    </div>
    <button
      class="chat-drawer-close"
      title="New chat"
      aria-label="Start a new chat"
      onclick={() => chatTab?.resetChat()}
    >
      <RotateCcw size={14} />
    </button>
    <button class="chat-drawer-close" title="Close" aria-label="Close chat" onclick={close}>
      <X size={15} />
    </button>
  </div>
  <div class="chat-drawer-body">
    <ChatTab bind:this={chatTab} />
  </div>
</aside>
