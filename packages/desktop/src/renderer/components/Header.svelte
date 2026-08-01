<script lang="ts">
  import { activeView, chatOpen } from '../lib/stores';
  import { MessageSquareText, Settings } from 'lucide-svelte';
  import Bot from './Bot.svelte';
</script>

<div class="header">
  <div class="header-left">
    <span class="header-logo">
      <Bot size={22} blink />
    </span>
    <span class="header-title">NomNomDrive</span>
  </div>
  <div class="header-actions">
    <button
      class="header-btn"
      title="Chat with your documents to test the agent"
      onclick={() => chatOpen.set(true)}
    >
      <MessageSquareText size={14} />
      <span>Test the agent</span>
    </button>
    <button class="icon-btn" title="Settings" onclick={() => activeView.set('settings')}>
      <Settings size={15} />
    </button>
  </div>
</div>
