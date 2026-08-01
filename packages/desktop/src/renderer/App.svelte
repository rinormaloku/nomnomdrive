<script lang="ts">
  import { onMount } from 'svelte';
  import { activeView, setupStatus, cloudStatus, tunnelStatus } from './lib/stores';
  import { initNomnom, nomnom } from './lib/nomnom';
  import Header from './components/Header.svelte';
  import HomeView from './components/HomeView.svelte';
  import ChatDrawer from './components/ChatDrawer.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Toast from './components/Toast.svelte';
  import SetupScreen from './components/SetupScreen.svelte';
  import SettingsScreen from './components/SettingsScreen.svelte';

  onMount(async () => {
    initNomnom();

    const refreshCloud = async () => {
      const status = await nomnom.getCloudStatus();
      cloudStatus.set(status);
      tunnelStatus.set(status.tunnelStatus);
    };
    await refreshCloud();
    nomnom.onCloudStatusChanged(refreshCloud);
    nomnom.onCloudTunnelStatus((s) => tunnelStatus.set(s));

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

  <!-- Both panes stay mounted so their reactive watchers keep running. -->
  <div class="view-pane" class:active={$activeView === 'home'}>
    <HomeView />
  </div>
  <div class="view-pane" class:active={$activeView === 'settings'}>
    <SettingsScreen />
  </div>

  <ChatDrawer />

  <StatusBar />
  <Toast />
{/if}
