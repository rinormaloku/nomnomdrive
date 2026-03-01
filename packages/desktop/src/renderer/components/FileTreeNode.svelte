<script lang="ts">
  import type { TreeNode } from '../lib/utils';
  import { countDocs } from '../lib/utils';
  import FileItem from './FileItem.svelte';
  import FileTreeNode from './FileTreeNode.svelte';

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
    <span class="tree-icon">
      {#if expanded}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M1.5 4C1.5 3.17 2.17 2.5 3 2.5H6L7.5 4H13C13.83 4 14.5 4.67 14.5 5.5V6L13 12.5H3L1.5 6.5V4Z" fill="#FFC940" stroke="#D4A020" stroke-width="1" />
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M2 3.5C2 2.67 2.67 2 3.5 2H6.5L8 3.5H12.5C13.33 3.5 14 4.17 14 5V12.5C14 13.33 13.33 14 12.5 14H3.5C2.67 14 2 13.33 2 12.5V3.5Z" fill="#FFC940" stroke="#D4A020" stroke-width="1" />
        </svg>
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
