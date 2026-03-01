<script lang="ts">
  import { syncActive } from '../lib/stores';
  import SyncFullView from './SyncFullView.svelte';
  import SyncBanner from './SyncBanner.svelte';
  import FileTree from './FileTree.svelte';
</script>

{#if $syncActive}
  <SyncFullView />
{:else}
  <SyncBanner />
  <FileTree />
{/if}
