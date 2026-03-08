<script lang="ts">
  import { activeTab } from '../lib/stores';
</script>

<div class="tab-bar">
  <button class="tab" class:active={$activeTab === 'files'} onclick={() => activeTab.set('files')}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2 3.5C2 2.67 2.67 2 3.5 2H6.5L8 3.5H12.5C13.33 3.5 14 4.17 14 5V12.5C14 13.33 13.33 14 12.5 14H3.5C2.67 14 2 13.33 2 12.5V3.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
    </svg>
    Files
  </button>
  <button class="tab" class:active={$activeTab === 'chat'} onclick={() => activeTab.set('chat')}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
      <path d="M5 5.5h6M5 8h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
    </svg>
    Chat
  </button>
  <button class="tab" class:active={$activeTab === 'mcp'} onclick={() => activeTab.set('mcp')}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M4 4h8v8H4z" stroke="currentColor" stroke-width="1.3" rx="1" />
      <path d="M7 1v3M9 1v3M7 12v3M9 12v3M1 7h3M1 9h3M12 7h3M12 9h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
    MCP
  </button>
  <button class="tab" class:active={$activeTab === 'cloud'} onclick={() => activeTab.set('cloud')}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M12.5 10.5a2.5 2.5 0 000-5 2.5 2.5 0 00-4.87-1A3 3 0 003.5 7.5a2.5 2.5 0 000 5h9z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
    </svg>
    Cloud
  </button>
</div>
