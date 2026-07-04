<script lang="ts">
  import { onDestroy } from 'svelte';
  import { documents, config } from '../lib/stores';
  import { nomnom } from '../lib/nomnom';
  import { buildTree } from '../lib/utils';
  import FileTreeNode from './FileTreeNode.svelte';
  import FileItem from './FileItem.svelte';
  import Bot from './Bot.svelte';

  let now = $state(Date.now());
  const interval = setInterval(() => (now = Date.now()), 30000);
  onDestroy(() => clearInterval(interval));

  let tree = $derived(buildTree($documents));
  let hasDocuments = $derived($documents.length > 0);
  let topFolders = $derived(Object.keys(tree.children).sort());
  let rootDocs = $derived(tree.docs.slice().sort((a, b) => b.indexedAt - a.indexedAt));
</script>

<div class="file-tree-container">
  {#if !hasDocuments}
    <div class="file-tree-empty">
      <div class="empty-bot">
        <Bot size={80} shadow blink mouth="open" />
      </div>
      <p class="empty-text">Feed me some nom nom docs!</p>
      <p class="empty-subtext">
        Drag files anywhere into this window, or drop them into your NomNomDrive folder.
      </p>
      <button
        class="btn-open-folder"
        onclick={() => $config.dropFolder && nomnom.openDropFolder($config.dropFolder)}
      >
        Open Drop Folder
      </button>
    </div>
  {:else}
    <ul class="file-tree">
      {#each topFolders as folderName}
        <FileTreeNode name={folderName} node={tree.children[folderName]} depth={0} {now} />
      {/each}
      {#each rootDocs as doc}
        <FileItem {doc} depth={0} {now} />
      {/each}
    </ul>
  {/if}
</div>
