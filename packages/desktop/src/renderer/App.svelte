<script lang="ts">
  import { onMount } from 'svelte';
  import { activeTab, setupStatus } from './lib/stores';
  import { initNomnom, nomnom } from './lib/nomnom';
  import Header from './components/Header.svelte';
  import TabBar from './components/TabBar.svelte';
  import FilesTab from './components/FilesTab.svelte';
  import ChatTab from './components/ChatTab.svelte';
  import McpTab from './components/McpTab.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Toast from './components/Toast.svelte';
  import SetupScreen from './components/SetupScreen.svelte';

  onMount(async () => {
    initNomnom();

    // Check if onboarding is needed
    try {
      const status = await nomnom.setupCheck();
      setupStatus.set({
        needsSetup: status.needsSetup,
        needsModelDownload: status.needsModelDownload,
        checked: true,
      });
    } catch {
      // If check fails, proceed normally
      setupStatus.set({ needsSetup: false, needsModelDownload: false, checked: true });
    }
  });

  $: showSetup = $setupStatus.checked && ($setupStatus.needsSetup || $setupStatus.needsModelDownload);
</script>

{#if !$setupStatus.checked}
  <!-- Still checking — show nothing while we determine if setup is needed -->
{:else if showSetup}
  <SetupScreen />
{:else}
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
{/if}
