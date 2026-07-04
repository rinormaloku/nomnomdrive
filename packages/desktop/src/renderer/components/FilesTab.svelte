<script lang="ts">
  import { syncActive, modelError, activeTab, showToast, setupProgress } from '../lib/stores';
  import { nomnom } from '../lib/nomnom';
  import SyncFullView from './SyncFullView.svelte';
  import SyncBanner from './SyncBanner.svelte';
  import FileTree from './FileTree.svelte';
  import Bot from './Bot.svelte';

  let dragging = $state(false);
  let dragCounter = 0;
  let nomming = $state(false);
  let nomTimer: ReturnType<typeof setTimeout> | null = null;

  const embedDownloading = $derived(
    $setupProgress.phase === 'embed' &&
      $setupProgress.total > 0 &&
      $setupProgress.downloaded < $setupProgress.total,
  );
  const downloadPct = $derived(
    $setupProgress.total > 0
      ? Math.floor(($setupProgress.downloaded / $setupProgress.total) * 100)
      : 0,
  );
  const downloadedMB = $derived(($setupProgress.downloaded / (1024 * 1024)).toFixed(1));
  const totalMB = $derived(($setupProgress.total / (1024 * 1024)).toFixed(1));

  function onDragEnter(e: DragEvent) {
    e.preventDefault();
    dragCounter++;
    dragging = true;
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dragging = false;
    }
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter = 0;
    dragging = false;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const p = nomnom.getPathForFile(files[i]);
        if (p) paths.push(p);
      } catch {
        // skip files without a native path
      }
    }
    if (paths.length === 0) return;

    // Let the mascot chomp while the files are copied into the watch folder
    nomming = true;
    if (nomTimer) clearTimeout(nomTimer);
    nomTimer = setTimeout(() => (nomming = false), 1200);

    const res = await nomnom.copyToWatchFolder(paths);
    if (!res.success) {
      nomming = false;
      showToast(res.error ?? 'Copy failed');
    } else {
      const errors = res.results?.filter((r) => r.error) ?? [];
      if (errors.length > 0) {
        showToast(`${paths.length - errors.length} copied, ${errors.length} failed`);
      } else {
        showToast(`Nom! ${paths.length} ${paths.length > 1 ? 'files' : 'file'} gobbled up`);
      }
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="files-tab"
  class:drag-over={dragging}
  ondragenter={onDragEnter}
  ondragleave={onDragLeave}
  ondragover={onDragOver}
  ondrop={onDrop}
>
  {#if dragging || nomming}
    <div class="drop-overlay">
      <div class="drop-bot" class:bot-eating={nomming}>
        <Bot size={130} ring={false} mouth={nomming ? 'chomp' : 'open'} papers={nomming} shadow />
      </div>
      {#if nomming}
        <p class="drop-text">Nom nom nom!</p>
      {:else}
        <p class="drop-text">Drop it! I'm hungry</p>
        <p class="drop-subtext">Files land in your NomNomDrive folder and get indexed</p>
      {/if}
    </div>
  {/if}

  {#if $modelError}
    <div class="model-error">
      <div class="model-error-icon">!</div>
      <div class="model-error-body">
        <p class="model-error-title">Embedding model failed to load</p>
        <p class="model-error-detail">{$modelError}</p>
        <p class="model-error-hint">File indexing is paused. Check the model path in settings.</p>
      </div>
      <button class="model-error-btn" onclick={() => activeTab.set('settings')}>Settings</button>
    </div>
  {/if}

  {#if embedDownloading}
    <div class="model-download">
      <div class="model-download-header">
        <span class="model-download-title">
          Downloading embedding model {$setupProgress.modelLabel}…
        </span>
        <span class="model-download-detail">{downloadedMB} / {totalMB} MB ({downloadPct}%)</span>
      </div>
      <div class="model-download-bar-wrap">
        <div class="model-download-bar" style="width: {downloadPct}%"></div>
      </div>
    </div>
  {/if}

  {#if $syncActive}
    <SyncFullView />
  {:else}
    <SyncBanner />
    <FileTree />
  {/if}
</div>

<style>
  .files-tab {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .drag-over {
    outline: 3px dashed var(--accent);
    outline-offset: -6px;
    border-radius: var(--radius);
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg) 88%, var(--accent));
    border-radius: var(--radius);
    pointer-events: none;
  }

  .drop-bot {
    /* Explicit size so the global .bot-eating (44px, sized for the banner bot)
       can't collapse this container in the nomming state */
    width: 130px;
    height: 130px;
    margin-bottom: 6px;
    animation: drop-bob 0.9s ease-in-out infinite;
  }

  .drop-bot.bot-eating {
    width: 130px;
    height: 130px;
    animation: none;
  }

  @keyframes drop-bob {
    0%,
    100% {
      transform: translateY(0) rotate(-2deg);
    }
    50% {
      transform: translateY(-10px) rotate(2deg);
    }
  }

  .drop-text {
    font-size: 18px;
    font-weight: 800;
    color: var(--accent);
    margin: 0;
  }

  .drop-subtext {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-secondary);
  }

  @media (prefers-reduced-motion: reduce) {
    .drop-bot {
      animation: none;
    }
  }

  .model-download {
    margin: 10px 16px;
    padding: 10px 12px;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .model-download-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }

  .model-download-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-download-detail {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .model-download-bar-wrap {
    height: 6px;
    border-radius: 3px;
    background: var(--bg3);
    overflow: hidden;
  }

  .model-download-bar {
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
    transition: width 0.3s ease;
  }

  .model-error {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 10px 16px;
    padding: 10px 12px;
    background: var(--red-light);
    border: 1px solid var(--red);
    border-radius: var(--radius-sm);
  }

  .model-error-icon {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--red);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    margin-top: 1px;
  }

  .model-error-body {
    flex: 1;
    min-width: 0;
  }

  .model-error-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 2px;
  }

  .model-error-detail {
    font-size: 11px;
    color: var(--red);
    margin: 0 0 4px;
    word-break: break-word;
  }

  .model-error-hint {
    font-size: 11px;
    color: var(--text-secondary);
    margin: 0;
  }

  .model-error-btn {
    flex-shrink: 0;
    padding: 5px 12px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--red);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    align-self: center;
  }

  .model-error-btn:hover {
    opacity: 0.9;
  }
</style>
