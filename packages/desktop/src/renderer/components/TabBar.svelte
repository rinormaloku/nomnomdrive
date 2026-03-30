<script lang="ts">
  import { activeTab } from '../lib/stores';
  import { Folder, MessageSquareText, Cpu, Cloud, Settings } from 'lucide-svelte';
</script>

<div class="tab-bar">
  <button class="tab" class:active={$activeTab === 'files'} onclick={() => activeTab.set('files')}>
    <Folder size={14} />
    Files
  </button>
  <button class="tab" class:active={$activeTab === 'chat'} onclick={() => activeTab.set('chat')}>
    <MessageSquareText size={14} />
    Chat
  </button>
  <button class="tab" class:active={$activeTab === 'mcp'} onclick={() => activeTab.set('mcp')}>
    <Cpu size={14} />
    MCP
  </button>
  <button class="tab" class:active={$activeTab === 'cloud'} onclick={() => activeTab.set('cloud')}>
    <Cloud size={14} />
    Cloud
  </button>
  <button class="tab" class:active={$activeTab === 'settings'} onclick={() => activeTab.set('settings')}>
    <Settings size={14} />
    Settings
  </button>
</div>
