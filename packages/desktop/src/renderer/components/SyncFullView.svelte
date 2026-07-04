<script lang="ts">
  import { syncProgress, processedFiles } from '../lib/stores';
  import { basename, formatEta } from '../lib/utils';
  import Bot from './Bot.svelte';

  let etaStartTime = 0;
  let etaStartChunks = 0;
  let lastFile = '';
  let eta = '';

  $: {
    const { filePath, chunksProcessed, chunksTotal } = $syncProgress;

    if (filePath !== lastFile) {
      etaStartTime = Date.now();
      etaStartChunks = chunksProcessed;
      lastFile = filePath;
      eta = '';
    } else if (chunksTotal > 0) {
      const elapsed = (Date.now() - etaStartTime) / 1000;
      const processed = chunksProcessed - etaStartChunks;
      if (processed > 0 && elapsed > 1) {
        const rate = processed / elapsed;
        const remaining = (chunksTotal - chunksProcessed) / rate;
        eta = formatEta(remaining);
      }
    }
  }

  $: pct =
    $syncProgress.chunksTotal > 0
      ? Math.round(($syncProgress.chunksProcessed / $syncProgress.chunksTotal) * 100)
      : 10;

  $: chunkLabel =
    $syncProgress.chunksTotal > 0
      ? `${$syncProgress.chunksProcessed}/${$syncProgress.chunksTotal} chunks`
      : $syncProgress.phase + '…';

  $: currentFileNumber = Math.min($syncProgress.filesDone + 1, $syncProgress.filesTotal);
  $: overallPct =
    $syncProgress.filesTotal > 0
      ? Math.round(($syncProgress.filesDone / $syncProgress.filesTotal) * 100)
      : 0;
</script>

<div class="sync-fullview">
  <div class="sync-fv-bot bot-eating">
    <Bot size={160} ring={false} mouth="chomp" papers shadow />
  </div>

  <p class="sync-fv-title">Nom nom nom…</p>

  {#if $syncProgress.filesTotal > 0}
    <div class="sync-fv-overall">
      <div class="sync-fv-overall-labels">
        <span>File {currentFileNumber} of {$syncProgress.filesTotal}</span>
        <span class="sync-fv-overall-pct">{overallPct}%</span>
      </div>
      <div class="sync-fv-overall-bar-wrap">
        <div class="sync-fv-overall-bar" style="width: {overallPct}%"></div>
      </div>
    </div>
  {/if}

  <div class="sync-fv-current">
    <div class="sync-fv-spinner"></div>
    <span class="sync-fv-filename" title={$syncProgress.filePath}>
      {basename($syncProgress.filePath)}
    </span>
  </div>

  <div class="sync-fv-meta">
    {#if $syncProgress.phase}
      <span class="sync-fv-phase">{$syncProgress.phase}</span>
    {/if}
    <span class="sync-fv-chunks">{chunkLabel}</span>
    {#if eta}
      <span class="sync-fv-eta">{eta}</span>
    {/if}
  </div>

  <div class="sync-fv-progress-wrap">
    <div class="sync-fv-progress" style="width: {pct}%"></div>
  </div>

  <div class="sync-fv-history-wrap">
    <div class="sync-fv-history-fade"></div>
    <ul class="sync-fv-history">
      {#each $processedFiles as file, i}
        {@const opacity = Math.max(0.2, 1 - i * 0.18)}
        <li style="opacity: {opacity.toFixed(2)}">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" fill="var(--green-light)" stroke="var(--green)" stroke-width="1" />
            <path d="M5.5 8l1.8 1.8 3.2-3.6" stroke="var(--green)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>{file.name}</span>
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .sync-fv-title {
    margin: 2px 0 12px;
    font-size: 15px;
    font-weight: 800;
    color: var(--accent);
    letter-spacing: 0.2px;
  }

  .sync-fv-overall {
    width: 100%;
    max-width: 320px;
    margin: 0 auto 14px;
  }

  .sync-fv-overall-labels {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .sync-fv-overall-pct {
    color: var(--text-secondary);
    font-weight: 500;
  }

  .sync-fv-overall-bar-wrap {
    height: 6px;
    border-radius: 3px;
    background: var(--bg3);
    overflow: hidden;
  }

  .sync-fv-overall-bar {
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
    transition: width 0.3s ease;
  }
</style>
