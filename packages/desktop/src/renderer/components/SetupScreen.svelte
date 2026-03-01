<script lang="ts">
  import { onMount } from 'svelte';
  import { nomnom } from '../lib/nomnom';
  import { setupStatus, setupProgress } from '../lib/stores';
  import type { ModelOption, SetupCatalog } from '../lib/types';

  type Step = 'loading' | 'welcome' | 'folder' | 'embed' | 'chat' | 'downloading' | 'done' | 'error';

  let step: Step = 'loading';
  let catalog: SetupCatalog | null = null;

  // Form state
  let watchPath = '';
  let selectedEmbed = '';
  let customEmbed = '';
  let selectedChat = '';
  let customChat = '';
  let mcpPort = 23847;

  // Download state
  let downloadError = '';

  onMount(async () => {
    try {
      catalog = await nomnom.setupGetCatalog();
      watchPath = catalog.defaults.watchPath;
      selectedEmbed = catalog.defaults.embedModelId;
      selectedChat = catalog.defaults.chatModelId;
      mcpPort = catalog.defaults.mcpPort;

      // Check if we need full setup or just model downloads
      const status = await nomnom.setupCheck();
      if (status.needsSetup) {
        step = 'welcome';
      } else if (status.needsModelDownload) {
        // Config exists but models missing — skip to downloading
        step = 'downloading';
        startDownload();
      }
    } catch (e: any) {
      downloadError = e.message;
      step = 'error';
    }
  });

  function nextFromWelcome() { step = 'folder'; }
  function nextFromFolder() { step = 'embed'; }
  function nextFromEmbed() { step = 'chat'; }

  async function nextFromChat() {
    step = 'downloading';
    await startDownload();
  }

  async function startDownload() {
    downloadError = '';
    const embedId = selectedEmbed === '__custom__' ? customEmbed : selectedEmbed;
    const chatId = selectedChat === '__custom__' ? customChat :
                   selectedChat === '__skip__' ? '' : selectedChat;

    try {
      const result = await nomnom.setupStart({
        watchPath,
        embedModelId: embedId,
        chatModelId: chatId,
        mcpPort,
      });

      if (result.success) {
        step = 'done';
      } else {
        downloadError = result.error ?? 'Setup failed';
        step = 'error';
      }
    } catch (e: any) {
      downloadError = e.message;
      step = 'error';
    }
  }

  function retry() {
    step = 'downloading';
    startDownload();
  }

  function finish() {
    setupStatus.set({ needsSetup: false, needsModelDownload: false, checked: true });
    // Trigger a page reload to restart with fresh config
    window.location.reload();
  }

  // Reactive progress display
  $: progressPct = $setupProgress.total > 0
    ? Math.floor(($setupProgress.downloaded / $setupProgress.total) * 100)
    : 0;
  $: progressMB = ($setupProgress.downloaded / (1024 * 1024)).toFixed(1);
  $: totalMB = ($setupProgress.total / (1024 * 1024)).toFixed(1);
  $: progressLabel = $setupProgress.modelLabel || 'Model';
</script>

<div class="setup-overlay">
  <div class="setup-container">

    {#if step === 'loading'}
      <div class="setup-center">
        <div class="setup-spinner"></div>
        <p class="setup-subtitle">Checking setup...</p>
      </div>

    {:else if step === 'welcome'}
      <div class="setup-center">
        <div class="setup-logo">🍕</div>
        <h2 class="setup-title">Welcome to NomNomDrive</h2>
        <p class="setup-subtitle">
          Your local AI document search. Let's set up your models —
          everything runs on your machine, nothing leaves your computer.
        </p>
        <button class="setup-btn primary" onclick={nextFromWelcome}>Get Started</button>
      </div>

    {:else if step === 'folder'}
      <div class="setup-step">
        <h3 class="setup-step-title">Watch Folder</h3>
        <p class="setup-step-desc">Where should NomNomDrive look for your documents?</p>
        <input
          type="text"
          class="setup-input"
          bind:value={watchPath}
          placeholder="~/Documents/NomNomDrive"
        />
        <div class="setup-nav">
          <button class="setup-btn secondary" onclick={() => step = 'welcome'}>Back</button>
          <button class="setup-btn primary" onclick={nextFromFolder}>Next</button>
        </div>
      </div>

    {:else if step === 'embed'}
      <div class="setup-step">
        <h3 class="setup-step-title">Embedding Model</h3>
        <p class="setup-step-desc">This model creates searchable representations of your documents.</p>
        <div class="setup-model-list">
          {#if catalog}
            {#each catalog.embedModels as model}
              <label class="setup-model-option" class:selected={selectedEmbed === model.id}>
                <input type="radio" name="embed" value={model.id} bind:group={selectedEmbed} />
                <span class="setup-model-name">
                  {model.label}
                  {#if model.recommended}<span class="setup-badge">recommended</span>{/if}
                </span>
                <span class="setup-model-size">{model.size}</span>
              </label>
            {/each}
            <label class="setup-model-option" class:selected={selectedEmbed === '__custom__'}>
              <input type="radio" name="embed" value="__custom__" bind:group={selectedEmbed} />
              <span class="setup-model-name">Custom model</span>
            </label>
          {/if}
          {#if selectedEmbed === '__custom__'}
            <input
              type="text"
              class="setup-input"
              bind:value={customEmbed}
              placeholder="hf:<org>/<repo> or /absolute/path"
            />
          {/if}
        </div>
        <div class="setup-nav">
          <button class="setup-btn secondary" onclick={() => step = 'folder'}>Back</button>
          <button class="setup-btn primary" onclick={nextFromEmbed}>Next</button>
        </div>
      </div>

    {:else if step === 'chat'}
      <div class="setup-step">
        <h3 class="setup-step-title">Chat Model</h3>
        <p class="setup-step-desc">For local Q&A with your documents. You can skip this if you only need MCP search.</p>
        <div class="setup-model-list">
          {#if catalog}
            {#each catalog.chatModels as model}
              <label class="setup-model-option" class:selected={selectedChat === model.id}>
                <input type="radio" name="chat" value={model.id} bind:group={selectedChat} />
                <span class="setup-model-name">
                  {model.label}
                  {#if model.recommended}<span class="setup-badge">recommended</span>{/if}
                </span>
                <span class="setup-model-size">{model.size}</span>
              </label>
            {/each}
            <label class="setup-model-option" class:selected={selectedChat === '__custom__'}>
              <input type="radio" name="chat" value="__custom__" bind:group={selectedChat} />
              <span class="setup-model-name">Custom model</span>
            </label>
            <label class="setup-model-option" class:selected={selectedChat === '__skip__'}>
              <input type="radio" name="chat" value="__skip__" bind:group={selectedChat} />
              <span class="setup-model-name">Skip — I only need MCP search</span>
            </label>
          {/if}
          {#if selectedChat === '__custom__'}
            <input
              type="text"
              class="setup-input"
              bind:value={customChat}
              placeholder="hf:<org>/<repo> or /absolute/path"
            />
          {/if}
        </div>
        <div class="setup-nav">
          <button class="setup-btn secondary" onclick={() => step = 'embed'}>Back</button>
          <button class="setup-btn primary" onclick={nextFromChat}>Download & Finish</button>
        </div>
      </div>

    {:else if step === 'downloading'}
      <div class="setup-center">
        <div class="setup-spinner"></div>
        <h3 class="setup-title">Downloading {progressLabel}</h3>
        <div class="setup-progress-wrap">
          <div class="setup-progress-bar" style="width: {progressPct}%"></div>
        </div>
        <p class="setup-progress-text">
          {#if $setupProgress.total > 0}
            {progressMB} / {totalMB} MB ({progressPct}%)
          {:else}
            Preparing download...
          {/if}
        </p>
        <p class="setup-subtitle">This may take a few minutes on first run.</p>
      </div>

    {:else if step === 'done'}
      <div class="setup-center">
        <div class="setup-done-icon">✓</div>
        <h3 class="setup-title">All Set!</h3>
        <p class="setup-subtitle">
          Models are downloaded and ready. Your documents will be indexed automatically.
        </p>
        <button class="setup-btn primary" onclick={finish}>Start Using NomNomDrive</button>
      </div>

    {:else if step === 'error'}
      <div class="setup-center">
        <div class="setup-error-icon">!</div>
        <h3 class="setup-title">Setup Error</h3>
        <p class="setup-error-text">{downloadError}</p>
        <button class="setup-btn primary" onclick={retry}>Retry</button>
      </div>
    {/if}

  </div>
</div>

<style>
  .setup-overlay {
    position: fixed;
    inset: 0;
    background: var(--bg);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
  }

  .setup-container {
    width: 100%;
    max-width: 420px;
    padding: 24px 28px;
  }

  .setup-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
  }

  .setup-step {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .setup-logo {
    font-size: 40px;
    margin-bottom: 4px;
  }

  .setup-title {
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .setup-subtitle {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  .setup-step-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .setup-step-desc {
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0 0 4px;
  }

  .setup-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    outline: none;
  }

  .setup-input:focus {
    border-color: var(--accent);
  }

  .setup-model-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
    overflow-y: auto;
  }

  .setup-model-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 12px;
    transition: border-color var(--transition), background var(--transition);
  }

  .setup-model-option:hover {
    background: var(--bg2);
  }

  .setup-model-option.selected {
    border-color: var(--accent);
    background: var(--accent-light);
  }

  .setup-model-option input[type="radio"] {
    margin: 0;
    accent-color: var(--accent);
  }

  .setup-model-name {
    flex: 1;
    font-weight: 500;
  }

  .setup-model-size {
    color: var(--text-dim);
    font-size: 11px;
  }

  .setup-badge {
    display: inline-block;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--accent);
    background: var(--accent-light);
    padding: 1px 5px;
    border-radius: 3px;
    margin-left: 4px;
  }

  .setup-nav {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
  }

  .setup-btn {
    padding: 8px 20px;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    transition: background var(--transition);
  }

  .setup-btn.primary {
    background: var(--accent);
    color: #fff;
  }

  .setup-btn.primary:hover {
    background: var(--accent-hover);
  }

  .setup-btn.secondary {
    background: var(--bg3);
    color: var(--text);
  }

  .setup-btn.secondary:hover {
    background: var(--border);
  }

  .setup-progress-wrap {
    width: 80%;
    height: 4px;
    background: var(--bg3);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 4px;
  }

  .setup-progress-bar {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .setup-progress-text {
    font-size: 11px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    margin: 0;
  }

  .setup-done-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--green-light);
    color: var(--green);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
  }

  .setup-error-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--red-light);
    color: var(--red);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
  }

  .setup-error-text {
    font-size: 12px;
    color: var(--red);
    word-break: break-word;
    margin: 0;
  }

  .setup-spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid var(--bg3);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: setup-spin 0.7s linear infinite;
  }

  @keyframes setup-spin {
    to { transform: rotate(360deg); }
  }
</style>
