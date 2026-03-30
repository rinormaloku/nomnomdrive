<script lang="ts">
  import type { ModelOption, ChatConfigValue } from '../../lib/types';
  import GgufPicker from './GgufPicker.svelte';

  export let value: ChatConfigValue = { provider: 'local', model: '' };
  export let catalog: ModelOption[] = [];

  const CUSTOM = '__custom__';

  // Internal state split by provider
  let provider: 'disabled' | 'local' | 'openai' =
    value.provider === 'openai' ? 'openai'
    : value.provider === 'local' && value.model ? 'local'
    : 'disabled';

  let localModel = value.provider === 'local' && value.model ? value.model : '';
  let localCustom = '';
  let ggufFile = '';
  let openaiModel = value.provider === 'openai' ? value.model : 'gpt-4.1-nano';
  let openaiKey = value.provider === 'openai' ? value.apiKey : '';
  let openaiBaseUrl = value.provider === 'openai' ? (value.baseUrl ?? '') : '';

  // Map localModel to selected dropdown value
  let selected: string;
  if (provider === 'local' && localModel) {
    // Strip hf: prefix for catalog matching
    const inCatalog = catalog.some((m) => m.id === localModel);
    if (inCatalog) {
      selected = localModel;
    } else {
      selected = CUSTOM;
      // Strip hf: prefix for display
      localCustom = localModel.startsWith('hf:') ? localModel.slice(3) : localModel;
    }
  } else {
    selected = catalog[0]?.id ?? CUSTOM;
  }

  function parseHfRepo(input: string): string | null {
    // Accept "org/repo" or "hf:org/repo"
    let cleaned = input.trim();
    if (cleaned.startsWith('hf:')) cleaned = cleaned.slice(3);
    const parts = cleaned.split('/');
    return parts.length === 2 && parts[0] && parts[1] ? parts.join('/') : null;
  }

  $: hfRepoId = selected === CUSTOM ? parseHfRepo(localCustom) : null;
  $: if (hfRepoId === null) ggufFile = '';

  function syncValue() {
    if (provider === 'disabled') {
      value = { provider: 'local', model: '' };
    } else if (provider === 'local') {
      if (selected === CUSTOM) {
        let model = localCustom.trim();
        // Auto-prepend hf: for org/repo patterns (not absolute paths)
        if (model && !model.startsWith('/') && !model.startsWith('hf:')) {
          const repo = parseHfRepo(model);
          if (repo) {
            model = 'hf:' + model;
          }
        }
        if (ggufFile && parseHfRepo(localCustom)) {
          model = 'hf:' + parseHfRepo(localCustom) + '/' + ggufFile;
        }
        value = { provider: 'local', model };
      } else {
        value = { provider: 'local', model: selected };
      }
    } else {
      value = { provider: 'openai', model: openaiModel, apiKey: openaiKey, ...(openaiBaseUrl ? { baseUrl: openaiBaseUrl } : {}) };
    }
  }

  $: { provider; selected; localCustom; ggufFile; openaiModel; openaiKey; openaiBaseUrl; syncValue(); }
</script>

<div class="chat-form">
  <div class="field">
    <label class="field-label" for="chat-provider">Provider</label>
    <select id="chat-provider" class="field-select" bind:value={provider}>
      <option value="disabled">Disabled — MCP tools only</option>
      <option value="local">Local (GGUF model)</option>
      <option value="openai">OpenAI / OpenAI-compatible API</option>
    </select>
  </div>

  {#if provider === 'disabled'}
    <p class="field-hint-block">Your documents are still searchable via MCP tools. Use Claude Code, Cursor, or any MCP client — see the MCP tab for setup.</p>

  {:else if provider === 'local'}
    <div class="field">
      <label class="field-label" for="chat-model">Model</label>
      <select id="chat-model" class="field-select" bind:value={selected}>
        {#each catalog as m}
          <option value={m.id}>{m.label}{m.recommended ? ' (recommended)' : ''} — {m.size}</option>
        {/each}
        <option value={CUSTOM}>Custom model...</option>
      </select>
    </div>

    {#if selected === CUSTOM}
      <div class="field">
        <input
          class="field-input"
          type="text"
          bind:value={localCustom}
          placeholder="org/repo (e.g. unsloth/Qwen3-8B-GGUF)"
        />
      </div>
      {#if hfRepoId}
        <GgufPicker repoId={hfRepoId} bind:selectedFile={ggufFile} />
      {/if}
    {/if}

  {:else}
    <div class="field">
      <label class="field-label" for="chat-openai-model">Model</label>
      <select id="chat-openai-model" class="field-select" bind:value={openaiModel}>
        <option value="gpt-4.1-nano">gpt-4.1-nano (fastest, cheapest)</option>
        <option value="gpt-4.1-mini">gpt-4.1-mini (recommended)</option>
        <option value="gpt-4o-mini">gpt-4o-mini</option>
        <option value="gpt-4o">gpt-4o</option>
        <option value="__custom__">Custom...</option>
      </select>
      {#if openaiModel === '__custom__'}
        <input class="field-input" type="text" bind:value={openaiModel} placeholder="model name" />
      {/if}
    </div>
    <div class="field">
      <label class="field-label" for="chat-openai-key">API Key</label>
      <input
        id="chat-openai-key"
        class="field-input"
        type="password"
        bind:value={openaiKey}
        placeholder="sk-... (or 'ollama' for Ollama)"
        autocomplete="off"
      />
    </div>
    <div class="field">
      <label class="field-label" for="chat-openai-url">Base URL <span class="field-hint">(leave blank for OpenAI; set for Ollama, LM Studio, Azure, etc.)</span></label>
      <input
        id="chat-openai-url"
        class="field-input"
        type="text"
        bind:value={openaiBaseUrl}
        placeholder="https://api.openai.com/v1"
        autocomplete="off"
      />
    </div>
  {/if}
</div>

<style>
  .chat-form {
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

  .field-hint-block {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
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
