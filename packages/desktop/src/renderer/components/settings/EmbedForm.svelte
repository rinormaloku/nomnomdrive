<script lang="ts">
  import type { ModelOption, EmbedConfigValue } from '../../lib/types';
  import GgufPicker from './GgufPicker.svelte';

  // Local duplicate of @nomnomdrive/shared's parseHfModelId — the renderer can't pull in the
  // shared barrel (it re-exports config.ts/models.ts, which need Node's fs/path/os).
  function parseHfModelId(id: string): { repo: string; filename: string } | null {
    if (!id.startsWith('hf:')) return null;
    const parts = id.slice(3).split('/');
    if (parts.length < 2) return null;
    return { repo: `${parts[0]}/${parts[1]}`, filename: parts.slice(2).join('/') };
  }

  export let value: EmbedConfigValue = { provider: 'local', model: '' };
  export let catalog: ModelOption[] = [];
  /** Memory we're planning against, in GB. null when hardware wasn't detected. */
  export let budgetGb: number | null = null;
  /** Memory already claimed by the chat model, so the two are scored together. */
  export let companionGb = 0;

  /** "~1 GB · fits" / "~4.8 GB · over budget" for a catalog entry. */
  function fitNote(m: ModelOption): string {
    if (budgetGb === null || m.runtimeGb === undefined) return '';
    const need = Math.round((m.runtimeGb + companionGb) * 10) / 10;
    return need <= budgetGb ? ` · ~${m.runtimeGb} GB` : ` · ~${m.runtimeGb} GB, over budget`;
  }

  $: selectedOverBudget =
    budgetGb !== null &&
    provider === 'local' &&
    catalogEntry?.runtimeGb !== undefined &&
    catalogEntry.runtimeGb + companionGb > budgetGb;

  // Internal state split by provider
  let provider: 'local' | 'openai' | 'gemini' = value.provider;
  let localModel = value.provider === 'local' ? value.model : '';
  let localCustom = '';
  let ggufFile = '';
  let truncateDim: number | '' = value.provider === 'local' && value.truncateDim ? value.truncateDim : '';
  let openaiModel = value.provider === 'openai' ? value.model : 'text-embedding-3-small';
  let openaiKey = value.provider === 'openai' ? value.apiKey : '';
  let openaiBaseUrl = value.provider === 'openai' ? (value.baseUrl ?? '') : '';
  let geminiModel = value.provider === 'gemini' ? value.model : 'text-embedding-004';
  let geminiKey = value.provider === 'gemini' ? value.apiKey : '';

  // If localModel matches a catalog entry, pick it; otherwise custom
  if (provider === 'local') {
    const inCatalog = catalog.some((m) => m.id === localModel);
    if (!inCatalog && localModel) {
      localCustom = localModel.startsWith('hf:') ? localModel.slice(3) : localModel;
      localModel = '__custom__';
    } else if (!localModel && catalog.length) {
      localModel = catalog[0].id;
    }
  }

  // Reset dims whenever the selected model changes — a different model has a different (or no) MRL range.
  let lastLocalModel = localModel;
  $: if (localModel !== lastLocalModel) {
    lastLocalModel = localModel;
    truncateDim = '';
  }

  function parseCustomRepo(input: string): { repo: string; filename: string } | null {
    const cleaned = input.trim().replace(/^hf:/, '');
    return cleaned ? parseHfModelId('hf:' + cleaned) : null;
  }

  $: catalogEntry = localModel === '__custom__' ? undefined : catalog.find((m) => m.id === localModel);
  $: parsedModel = localModel === '__custom__' ? parseCustomRepo(localCustom) : parseHfModelId(localModel);
  $: hfRepoId = parsedModel?.repo ?? null;
  $: preferredFile = parsedModel?.filename ?? '';
  $: if (hfRepoId === null) ggufFile = '';

  function syncValue() {
    if (provider === 'local') {
      let model: string;
      if (localModel === '__custom__') {
        const repo = parseCustomRepo(localCustom)?.repo;
        model = repo ? 'hf:' + repo + (ggufFile ? '/' + ggufFile : '') : localCustom.trim();
      } else {
        model = ggufFile && parsedModel ? 'hf:' + parsedModel.repo + '/' + ggufFile : localModel;
      }
      value = { provider: 'local', model, ...(truncateDim !== '' ? { truncateDim } : {}) };
    } else if (provider === 'openai') {
      value = { provider: 'openai', model: openaiModel, apiKey: openaiKey, ...(openaiBaseUrl ? { baseUrl: openaiBaseUrl } : {}) };
    } else {
      value = { provider: 'gemini', model: geminiModel, apiKey: geminiKey };
    }
  }

  $: { provider; localModel; localCustom; ggufFile; truncateDim; openaiModel; openaiKey; openaiBaseUrl; geminiModel; geminiKey; syncValue(); }
</script>

<div class="embed-form">
  <div class="field">
    <label class="field-label" for="embed-provider">Provider</label>
    <select id="embed-provider" class="field-select" bind:value={provider}>
      <option value="local">Local (GGUF model, offline)</option>
      <option value="openai">OpenAI / OpenAI-compatible API</option>
      <option value="gemini">Google Gemini API</option>
    </select>
  </div>

  {#if provider === 'local'}
    <div class="field">
      <label class="field-label" for="embed-local-model">Model</label>
      <select id="embed-local-model" class="field-select" bind:value={localModel}>
        {#each catalog as m}
          <option value={m.id}>
            {m.label}{m.recommended ? ' (recommended)' : ''} — {m.size}{fitNote(m)}
          </option>
        {/each}
        <option value="__custom__">Custom model…</option>
      </select>
      {#if selectedOverBudget}
        <p class="field-warn">
          This needs more memory than we've budgeted ({budgetGb} GB). It will still run,
          but expect it to spill to system RAM and index slowly.
        </p>
      {/if}
    </div>
    {#if localModel === '__custom__'}
      <div class="field">
        <input
          id="embed-local-custom"
          class="field-input"
          type="text"
          bind:value={localCustom}
          placeholder="org/repo (e.g. Qwen/Qwen3-Embedding-0.6B-GGUF)"
        />
      </div>
    {/if}
    {#if hfRepoId}
      <GgufPicker repoId={hfRepoId} {preferredFile} bind:selectedFile={ggufFile} />
    {/if}
    {#if catalogEntry?.supportedDims}
      <div class="field">
        <label class="field-label" for="embed-dims">Dimensions</label>
        <select id="embed-dims" class="field-select" bind:value={truncateDim}>
          <option value="">{catalogEntry.supportedDims[0]} (native, recommended)</option>
          {#each catalogEntry.supportedDims.slice(1) as d}
            <option value={d}>{d}</option>
          {/each}
        </select>
      </div>
    {/if}

  {:else if provider === 'openai'}
    <div class="field">
      <label class="field-label" for="embed-openai-model">Model</label>
      <select id="embed-openai-model" class="field-select" bind:value={openaiModel}>
        <option value="text-embedding-3-small">text-embedding-3-small (1536d, recommended)</option>
        <option value="text-embedding-3-large">text-embedding-3-large (3072d)</option>
        <option value="text-embedding-ada-002">text-embedding-ada-002 (1536d, legacy)</option>
        <option value="__custom__">Custom…</option>
      </select>
      {#if openaiModel === '__custom__'}
        <input class="field-input" type="text" bind:value={openaiModel} placeholder="model name" />
      {/if}
    </div>
    <div class="field">
      <label class="field-label" for="embed-openai-key">API Key</label>
      <input
        id="embed-openai-key"
        class="field-input"
        type="password"
        bind:value={openaiKey}
        placeholder="sk-…"
        autocomplete="off"
      />
    </div>
    <div class="field">
      <label class="field-label" for="embed-openai-url">Base URL <span class="field-hint">(leave blank for OpenAI; set for Ollama, Azure, etc.)</span></label>
      <input
        id="embed-openai-url"
        class="field-input"
        type="text"
        bind:value={openaiBaseUrl}
        placeholder="https://api.openai.com/v1"
        autocomplete="off"
      />
    </div>

  {:else if provider === 'gemini'}
    <div class="field">
      <label class="field-label" for="embed-gemini-model">Model</label>
      <select id="embed-gemini-model" class="field-select" bind:value={geminiModel}>
        <option value="text-embedding-004">text-embedding-004 (768d, recommended)</option>
        <option value="__custom__">Custom…</option>
      </select>
      {#if geminiModel === '__custom__'}
        <input class="field-input" type="text" bind:value={geminiModel} placeholder="model name" />
      {/if}
    </div>
    <div class="field">
      <label class="field-label" for="embed-gemini-key">API Key</label>
      <input
        id="embed-gemini-key"
        class="field-input"
        type="password"
        bind:value={geminiKey}
        placeholder="AIza…"
        autocomplete="off"
      />
    </div>
  {/if}
</div>

<style>
  .embed-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

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

  .field-hint {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-dim);
  }

  .field-warn {
    font-size: 11px;
    line-height: 1.45;
    color: var(--yellow, #e5a100);
    margin: 2px 0 0;
  }

  .field-select,
  .field-input {
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
  }

  .field-select:focus,
  .field-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-light);
  }

  .field-select {
    cursor: pointer;
  }
</style>
