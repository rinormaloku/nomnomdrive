<script lang="ts">
  import { onMount } from 'svelte';
  import { activeTab } from './lib/stores';
  import { initNomnom } from './lib/nomnom';
  import Header from './components/Header.svelte';
  import TabBar from './components/TabBar.svelte';
  import FilesTab from './components/FilesTab.svelte';
  import ChatTab from './components/ChatTab.svelte';
  import McpTab from './components/McpTab.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Toast from './components/Toast.svelte';

  onMount(() => {
    initNomnom();
  });
</script>

<Header />
<TabBar />

<div class="tab-content" class:active={$activeTab === 'files'} id="tab-files">
  <FilesTab />
</div>
<div class="tab-content" class:active={$activeTab === 'chat'} id="tab-chat">
  <ChatTab />
</div>
<div class="tab-content" class:active={$activeTab === 'mcp'} id="tab-mcp">
  <McpTab />
</div>

<StatusBar />
<Toast />
