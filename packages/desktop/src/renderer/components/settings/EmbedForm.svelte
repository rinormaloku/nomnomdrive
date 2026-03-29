<script lang="ts">
  import type { ModelOption, EmbedConfigValue } from '../../lib/types';
  import GgufPicker from './GgufPicker.svelte';

  export let value: EmbedConfigValue = { provider: 'local', model: '' };
  export let catalog: ModelOption[] = [];

  // Internal state split by provider
  let provider: 'local' | 'openai' | 'gemini' = value.provider;
  let localModel = value.provider === 'local' ? value.model : '';
  let localCustom = '';
  let localIsCustom = false;
  let ggufFile = '';
  let openaiModel = value.provider === 'openai' ? value.model : 'text-embedding-3-small';
  let openaiKey = value.provider === 'openai' ? value.apiKey : '';
  let openaiBaseUrl = value.provider === 'openai' ? (value.baseUrl ?? '') : '';
  let geminiModel = value.provider === 'gemini' ? value.model : 'text-embedding-004';
  let geminiKey = value.provider === 'gemini' ? value.apiKey : '';

  // If localModel matches a catalog entry, pick it; otherwise custom
  if (provider === 'local') {
    const inCatalog = catalog.some((m) => m.id === localModel);
    if (!inCatalog && localModel) {
      localIsCustom = true;
      localCustom = localModel.startsWith('hf:') ? localModel.slice(3) : localModel;
      localModel = '__custom__';
    } else if (!localModel && catalog.length) {
      localModel = catalog[0].id;
    }
  }

  function parseHfRepo(input: string): string | null {
    let cleaned = input.trim();
    if (cleaned.startsWith('hf:')) cleaned = cleaned.slice(3);
    const parts = cleaned.split('/');
    return parts.length === 2 && parts[0] && parts[1] ? parts.join('/') : null;
  }

  $: hfRepoId = localModel === '__custom__' ? parseHfRepo(localCustom) : null;
  $: if (hfRepoId === null) ggufFile = '';

  function syncValue() {
    if (provider === 'local') {
      let model = localModel === '__custom__' ? localCustom.trim() : localModel;
      // Auto-prepend hf: for org/repo patterns
      if (localModel === '__custom__' && model && !model.startsWith('/') && !model.startsWith('hf:')) {
        const repo = parseHfRepo(model);
        if (repo) model = 'hf:' + model;
      }
      // Append selected GGUF file to hf:org/repo
      if (localModel === '__custom__' && ggufFile && parseHfRepo(localCustom)) {
        model = 'hf:' + parseHfRepo(localCustom) + '/' + ggufFile;
      }
      value = { provider: 'local', model };
    } else if (provider === 'openai') {
      value = { provider: 'openai', model: openaiModel, apiKey: openaiKey, ...(openaiBaseUrl ? { baseUrl: openaiBaseUrl } : {}) };
    } else {
      value = { provider: 'gemini', model: geminiModel, apiKey: geminiKey };
    }
  }

  $: { provider; localModel; localCustom; ggufFile; openaiModel; openaiKey; openaiBaseUrl; geminiModel; geminiKey; syncValue(); }
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
          <option value={m.id}>{m.label}{m.recommended ? ' (recommended)' : ''} — {m.size}</option>
        {/each}
        <option value="__custom__">Custom model…</option>
      </select>
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
      {#if hfRepoId}
        <GgufPicker repoId={hfRepoId} bind:selectedFile={ggufFile} />
      {/if}
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
  }

  .field-select {
    cursor: pointer;
  }
</style>
