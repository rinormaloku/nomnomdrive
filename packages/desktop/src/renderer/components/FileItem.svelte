<script lang="ts">
  import type { Document } from '../lib/types';
  import { nomnom } from '../lib/nomnom';
  import { timeAgo, formatSize, fileIconSvg, basename } from '../lib/utils';

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
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="#e1e1e8" stroke-width="1.5" />
          <path d="M14 8a6 6 0 00-6-6" stroke="#0061ff" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </span>
    {:else if doc._error}
      <span class="file-status error">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="#de350b" stroke-width="1.5" />
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#de350b" stroke-width="1.3" stroke-linecap="round" />
        </svg>
      </span>
    {:else}
      <span class="file-status done">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" fill="#e6f4ee" stroke="#00875a" stroke-width="1" />
          <path d="M5.5 8l1.8 1.8 3.2-3.6" stroke="#00875a" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    {/if}

    <span class="tree-meta">{timeAgo(doc.indexedAt, now)}</span>
    <span class="tree-meta">{formatSize(doc.fileSize)}</span>
    {#if doc.chunkCount}
      <span class="tree-chunks">{doc.chunkCount} chunks</span>
    {/if}
  </div>
</li>
