<script lang="ts">
  import { nomnom } from '../../lib/nomnom';

  export let paths: string[] = [];

  let adding = false;
  let newPath = '';

  async function pickFolder() {
    const picked = await nomnom.openFolderDialog();
    if (picked) {
      if (!paths.includes(picked)) {
        paths = [...paths, picked];
      }
    }
  }

  function removeFolder(p: string) {
    paths = paths.filter((x) => x !== p);
  }

  function addManual() {
    const trimmed = newPath.trim();
    if (trimmed && !paths.includes(trimmed)) {
      paths = [...paths, trimmed];
    }
    newPath = '';
    adding = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') addManual();
    if (e.key === 'Escape') { adding = false; newPath = ''; }
  }
</script>

<div class="folders-form">
  {#if paths.length === 0}
    <p class="empty">No folders configured.</p>
  {:else}
    <ul class="folder-list">
      {#each paths as p}
        <li class="folder-item">
          <span class="folder-path" title={p}>{p}</span>
          <button class="remove-btn" onclick={() => removeFolder(p)} title="Remove folder">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if adding}
    <div class="add-row">
      <input
        class="add-input"
        type="text"
        bind:value={newPath}
        placeholder="/path/to/folder"
        onkeydown={onKeydown}
      />
      <button class="add-confirm-btn" onclick={addManual}>Add</button>
      <button class="cancel-btn" onclick={() => { adding = false; newPath = ''; }}>Cancel</button>
    </div>
  {:else}
    <div class="add-buttons">
      <button class="add-btn" onclick={pickFolder}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        Browse…
      </button>
      <button class="add-btn" onclick={() => adding = true}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        Enter path
      </button>
    </div>
  {/if}
</div>

<style>
  .folders-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .empty {
    font-size: 12px;
    color: var(--text-dim);
    margin: 0;
  }

  .folder-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .folder-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }

  .folder-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .remove-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    transition: color var(--transition), background var(--transition);
  }

  .remove-btn:hover {
    color: var(--red);
    background: var(--red-light);
  }

  .add-buttons {
    display: flex;
    gap: 6px;
  }

  .add-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font);
    color: var(--accent);
    background: var(--accent-light);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition), opacity var(--transition);
  }

  .add-btn:hover {
    opacity: 0.85;
  }

  .add-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .add-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    outline: none;
  }

  .add-confirm-btn {
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font);
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .cancel-btn {
    padding: 6px 10px;
    font-size: 11px;
    font-family: var(--font);
    background: var(--bg3);
    color: var(--text);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
</style>
