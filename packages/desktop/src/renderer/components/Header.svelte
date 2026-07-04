<script lang="ts">
  import { config, activeTab } from '../lib/stores';
  import { nomnom } from '../lib/nomnom';
  import { FolderOpen, Settings } from 'lucide-svelte';
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
      title="Open drop folder"
      onclick={() => $config.dropFolder && nomnom.openDropFolder($config.dropFolder)}
    >
      <FolderOpen size={14} />
      <span>Open Folder</span>
    </button>
    <button class="icon-btn" title="Settings" onclick={() => activeTab.set('settings')}>
      <Settings size={15} />
    </button>
  </div>
</div>
