<script lang="ts">
  import type { Document } from '../lib/types';
  import { nomnom } from '../lib/nomnom';
  import { timeAgo, formatSize, fileIconSvg, basename } from '../lib/utils';
  import { Loader2, XCircle, CheckCircle2 } from 'lucide-svelte';

  let { doc, depth, now = Date.now() }: { doc: Document; depth: number; now?: number } = $props();
</script>

<li class="tree-file">
  <div
    class="tree-row tree-file-row"
    style="padding-left: {depth * 16 + 10}px"
    title={doc.relativePath}
    ondblclick={() => doc.absolutePath && nomnom.openFile(doc.absolutePath)}
    role="row"
    tabindex="-1"
  >
    <span class="tree-icon">{@html fileIconSvg(doc.fileType)}</span>
    <span class="tree-name">{basename(doc.relativePath)}</span>

    {#if doc._syncing}
      <span class="file-status syncing">
        <Loader2 size={12} class="spin" color="var(--accent)" />
      </span>
    {:else if doc._error}
      <span class="file-status error">
        <XCircle size={12} color="var(--red)" />
      </span>
    {:else}
      <span class="file-status done">
        <CheckCircle2 size={12} color="var(--green)" />
      </span>
    {/if}

    <span class="tree-meta">{timeAgo(doc.indexedAt, now)}</span>
    <span class="tree-meta">{formatSize(doc.fileSize)}</span>
    {#if doc.chunkCount}
      <span class="tree-chunks">{doc.chunkCount} chunks</span>
    {/if}
  </div>
</li>

<style>
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
