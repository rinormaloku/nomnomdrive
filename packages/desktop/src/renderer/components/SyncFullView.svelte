<script lang="ts">
  import { syncProgress, processedFiles } from '../lib/stores';
  import { basename, formatEta } from '../lib/utils';

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
</script>

<div class="sync-fullview">
  <div class="sync-fv-bot bot-eating">
    <svg viewBox="0 0 344 344" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="mClipFv">
          <rect x="0" y="248" width="344" height="200" />
        </clipPath>
        <filter id="bFvSh" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="3" stdDeviation="6" flood-opacity=".12" />
        </filter>
      </defs>
      <g class="anim-head" filter="url(#bFvSh)">
        <path class="b" d="m135.9 285.1c-27.9-4.1-54-12.1-77.6-27.2-32.5-20.9-46.7-50.1-40.5-88.6 10.2-63.4 43.9-109.1 105.1-130 87.4-29.8 177.9 21.8 200 112 3.9 16 6 32.2 3.8 48.5-3.4 25.2-18.4 42.7-38.6 56.4-25.8 17.5-54.9 25.9-85.5 29.7-22.1 2.7-44.2 2.3-66.7-0.8zm-62.7-162.4c-13.7 14.4-19 32.1-20.3 51.4-1.9 25.8 9 44.3 31.7 56.2 3.5 1.8 7.2 3.5 10.9 4.9 30.1 11.2 61.5 12.6 93.1 11.2 22.7-0.9 45.1-4.3 66.1-13.7 27.9-12.6 39.4-32.8 36.2-63.2-2.9-27.5-15.2-49.1-40.5-61.9-7.2-3.6-15-6.6-22.8-8.4-33.1-7.8-66.4-7.8-99.8-2.5-20.4 3.3-39.2 10.3-54.6 26z" fill="#fcfcfc" />
        <path class="c" d="m73.4 122.4c15.2-15.4 34-22.4 54.4-25.7 33.4-5.3 66.7-5.3 99.8 2.5 7.8 1.8 15.6 4.8 22.8 8.4 25.3 12.8 37.6 34.4 40.5 61.9 3.2 30.4-8.3 50.6-36.2 63.2-21 9.4-43.4 12.8-66.1 13.7-31.6 1.4-63 0-93.1-11.2-3.7-1.4-7.4-3.1-10.9-4.9-22.7-11.9-33.6-30.4-31.7-56.2 1.3-19.3 6.6-37 20.5-51.7zm22.1 47.7c-1.8 6.3-0.8 10.2 3.3 11.5 5.3 1.6 7.7-1.5 9.7-6 2.2-4.7 6.5-7.1 11.8-7.1 5.2 0 9.2 2.4 11.8 7 0.5 0.8 0.8 1.8 1.3 2.7 1.7 3.2 4.5 4.5 7.9 3.5 3.6-0.9 5.4-3.6 4.8-7.1-0.5-3-1.5-6.2-3.2-8.8-11.9-17.6-37-15.6-47.4 4.3zm128.9-16.2c-1.5 0.1-3 0-4.5 0.2-10.2 1.2-20.2 9.7-21.9 18.6-0.7 4 0.1 7.5 4.4 8.9 4.1 1.4 7.1-0.3 8.7-4.4 2.4-5.6 6.7-8.8 12.8-8.7 6 0.1 10.2 3.3 12.5 9 1.6 4.2 4.9 5.5 8.9 4 3.9-1.4 5.1-4.6 4.2-8.5-0.5-2.1-1.4-4.1-2.5-6-4.9-8.1-12.2-12.4-22.6-13.1z" fill="#010202" />
        <path class="d" d="m95.6 169.8c10.3-19.6 35.4-21.6 47.3-4 1.7 2.6 2.7 5.8 3.2 8.8 0.6 3.5-1.2 6.2-4.8 7.1-3.4 1-6.2-0.3-7.9-3.5-0.5-0.9-0.8-1.9-1.3-2.7-2.6-4.6-6.6-7-11.8-7-5.3 0-9.6 2.4-11.8 7.1-2 4.5-4.4 7.6-9.7 6-4.1-1.3-5.1-5.2-3.2-11.8z" fill="#4bb3ec" />
        <path class="d" d="m224.9 153.9c9.9 0.7 17.2 5 22.1 13.1 1.1 1.9 2 3.9 2.5 6 0.9 3.9-0.3 7.1-4.2 8.5-4 1.5-7.3 0.2-8.9-4-2.3-5.7-6.5-8.9-12.5-9-6.1-0.1-10.4 3.1-12.8 8.7-1.6 4.1-4.6 5.8-8.7 4.4-4.3-1.4-5.1-4.9-4.4-8.9 1.7-8.9 11.7-17.4 21.9-18.6 1.5-0.2 3-0.1 5-0.2z" fill="#4bb3ec" />
        <path class="anim-mouth" d="M132,220 Q172,225 212,220" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" />
      </g>
      <g clip-path="url(#mClipFv)">
        <g class="anim-paper-1">
          <rect x="147" y="240" width="50" height="65" fill="white" rx="2" stroke="#e2e8f0" stroke-width="1" />
          <line x1="154" y1="255" x2="190" y2="255" stroke="#94a3b8" stroke-width="2" />
          <line x1="154" y1="265" x2="182" y2="265" stroke="#94a3b8" stroke-width="2" />
          <line x1="154" y1="275" x2="187" y2="275" stroke="#94a3b8" stroke-width="2" />
        </g>
        <g class="anim-paper-2">
          <rect x="157" y="240" width="45" height="60" fill="#f8fafc" rx="2" transform="rotate(5,179,270)" stroke="#e2e8f0" stroke-width="1" />
          <line x1="162" y1="255" x2="192" y2="255" stroke="#94a3b8" stroke-width="2" transform="rotate(5,179,270)" />
          <line x1="162" y1="265" x2="187" y2="265" stroke="#94a3b8" stroke-width="2" transform="rotate(5,179,270)" />
        </g>
      </g>
    </svg>
  </div>

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
            <circle cx="8" cy="8" r="6" fill="#e6f4ee" stroke="#00875a" stroke-width="1" />
            <path d="M5.5 8l1.8 1.8 3.2-3.6" stroke="#00875a" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>{file.name}</span>
        </li>
      {/each}
    </ul>
  </div>
</div>
