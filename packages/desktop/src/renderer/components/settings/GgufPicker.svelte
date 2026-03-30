<script lang="ts">
  import { nomnom } from '../../lib/nomnom';

  export let repoId = '';
  export let selectedFile = '';

  type GgufFile = { filename: string; size: number };

  let files: GgufFile[] = [];
  let loading = false;
  let error = false;
  let lastFetched = '';
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function formatSize(bytes: number): string {
    if (bytes <= 0) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }

  async function fetchFiles(repo: string) {
    if (!repo || repo === lastFetched) return;
    loading = true;
    error = false;
    files = [];
    try {
      files = await nomnom.listGgufFiles(repo);
      lastFetched = repo;
      // Reset selection when repo changes
      selectedFile = '';
    } catch {
      error = true;
    } finally {
      loading = false;
    }
  }

  $: {
    const repo = repoId;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (repo && repo !== lastFetched) {
      debounceTimer = setTimeout(() => fetchFiles(repo), 500);
    }
  }
</script>

{#if loading}
  <p class="gguf-hint">Loading quantizations...</p>
{:else if error}
  <p class="gguf-hint gguf-error">Could not fetch GGUF files from this repo.</p>
{:else if files.length > 1}
  <div class="field">
    <label class="field-label" for="gguf-quant">Quantization</label>
    <select id="gguf-quant" class="field-select" bind:value={selectedFile}>
      <option value="">Auto (Q4_K_M preferred)</option>
      {#each files as f}
        <option value={f.filename}>
          {f.filename}{formatSize(f.size) ? ` — ${formatSize(f.size)}` : ''}
        </option>
      {/each}
    </select>
  </div>
{/if}

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .field-select {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    outline: none;
    box-sizing: border-box;
    cursor: pointer;
  }

  .field-select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-light);
  }

  .gguf-hint {
    font-size: 11px;
    color: var(--text-secondary);
    margin: 0;
  }

  .gguf-error {
    color: var(--red);
  }
</style>
