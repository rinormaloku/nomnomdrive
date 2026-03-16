<script lang="ts">
  import type { ModelOption } from '../../lib/types';

  export let value: string = ''; // model ID, or '' to disable
  export let catalog: ModelOption[] = [];
  export let allowSkip = false;

  const CUSTOM = '__custom__';
  const SKIP = '__skip__';

  let selected: string;
  let customValue = '';

  // Init: map value to selected
  if (!value) {
    selected = allowSkip ? SKIP : (catalog[0]?.id ?? CUSTOM);
  } else {
    const inCatalog = catalog.some((m) => m.id === value);
    if (inCatalog) {
      selected = value;
    } else {
      selected = CUSTOM;
      customValue = value;
    }
  }

  function syncValue() {
    if (selected === SKIP) {
      value = '';
    } else if (selected === CUSTOM) {
      value = customValue;
    } else {
      value = selected;
    }
  }

  $: { selected; customValue; syncValue(); }
</script>

<div class="chat-form">
  <div class="field">
    <label class="field-label" for="chat-model">Model</label>
    <select id="chat-model" class="field-select" bind:value={selected}>
      {#each catalog as m}
        <option value={m.id}>{m.label}{m.recommended ? ' (recommended)' : ''} — {m.size}</option>
      {/each}
      <option value={CUSTOM}>Custom model…</option>
      {#if allowSkip}
        <option value={SKIP}>Disabled — MCP search only</option>
      {/if}
    </select>
  </div>

  {#if selected === CUSTOM}
    <div class="field">
      <input
        class="field-input"
        type="text"
        bind:value={customValue}
        placeholder="hf:<org>/<repo> or /absolute/path"
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
