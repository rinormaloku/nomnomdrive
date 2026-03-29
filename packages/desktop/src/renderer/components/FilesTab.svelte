<script lang="ts">
  import { syncActive, modelError, activeTab, showToast } from '../lib/stores';
  import { nomnom } from '../lib/nomnom';
  import SyncFullView from './SyncFullView.svelte';
  import SyncBanner from './SyncBanner.svelte';
  import FileTree from './FileTree.svelte';

  let dragging = $state(false);
  let dragCounter = 0;

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

    const res = await nomnom.copyToWatchFolder(paths);
    if (!res.success) {
      showToast(res.error ?? 'Copy failed');
    } else {
      const errors = res.results?.filter((r) => r.error) ?? [];
      if (errors.length > 0) {
        showToast(`${paths.length - errors.length} copied, ${errors.length} failed`);
      } else {
        showToast(`${paths.length} item${paths.length > 1 ? 's' : ''} copied`);
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
  {#if dragging}
    <div class="drop-overlay">
      <div class="drop-icon">+</div>
      <p class="drop-text">Drop files or folders to import</p>
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
    outline: 2px dashed var(--accent, #3b82f6);
    outline-offset: -4px;
    border-radius: var(--radius-sm, 6px);
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg, #fff) 85%, var(--accent, #3b82f6));
    border-radius: var(--radius-sm, 6px);
    pointer-events: none;
  }

  .drop-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--accent, #3b82f6);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .drop-text {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    margin: 0;
  }

  .model-error {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 10px 16px;
    padding: 10px 12px;
    background: var(--red-light, #fef2f2);
    border: 1px solid var(--red, #ef4444);
    border-radius: var(--radius-sm, 6px);
  }

  .model-error-icon {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--red, #ef4444);
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
    color: var(--red, #ef4444);
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
    border-radius: var(--radius-sm, 6px);
    background: var(--red, #ef4444);
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
