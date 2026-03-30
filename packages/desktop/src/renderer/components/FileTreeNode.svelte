<script lang="ts">
  import type { TreeNode } from '../lib/utils';
  import { countDocs } from '../lib/utils';
  import FileItem from './FileItem.svelte';
  import FileTreeNode from './FileTreeNode.svelte';
  import { FolderOpen, Folder } from 'lucide-svelte';

  let {
    name,
    node,
    depth,
    now = Date.now(),
  }: { name: string; node: TreeNode; depth: number; now?: number } = $props();

  let expanded = $state(true);

  let docCount = $derived(countDocs(node));
  let padding = $derived(depth * 16 + 10);
  let sortedFolders = $derived(Object.keys(node.children).sort());
  let sortedDocs = $derived(node.docs.slice().sort((a, b) => b.indexedAt - a.indexedAt));
</script>

<li class="tree-folder">
  <div
    class="tree-row tree-folder-row"
    style="padding-left: {padding}px"
    onclick={() => (expanded = !expanded)}
    onkeydown={(e) => e.key === 'Enter' && (expanded = !expanded)}
    role="button"
    tabindex="0"
  >
    <span class="tree-toggle" class:expanded>&#9654;</span>
    <span class="tree-icon tree-folder-icon">
      {#if expanded}
        <FolderOpen size={14} color="#D4A020" fill="#FFC940" />
      {:else}
        <Folder size={14} color="#D4A020" fill="#FFC940" />
      {/if}
    </span>
    <span class="tree-name">{name}</span>
    <span class="tree-badge">{docCount}</span>
  </div>

  {#if expanded}
    <ul class="tree-children">
      {#each sortedFolders as childName}
        <FileTreeNode name={childName} node={node.children[childName]} depth={depth + 1} {now} />
      {/each}
      {#each sortedDocs as doc}
        <FileItem {doc} depth={depth + 1} {now} />
      {/each}
    </ul>
  {/if}
</li>
