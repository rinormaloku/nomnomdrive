<script lang="ts">
  import { onMount } from 'svelte';
  import { nomnom } from '../lib/nomnom';
  import { setupStatus, setupProgress, setupGpuFailed, activeTab } from '../lib/stores';
  import type { ModelOption, SetupCatalog } from '../lib/types';
  import EmbedForm from './settings/EmbedForm.svelte';
  import type { EmbedConfigValue, ChatConfigValue } from '../lib/types';
  import ChatModelForm from './settings/ChatModelForm.svelte';

  type Step = 'loading' | 'welcome' | 'folder' | 'embed' | 'chat' | 'gpu' | 'downloading' | 'done' | 'error';

  let step: Step = 'loading';
  let catalog: SetupCatalog | null = null;

  // Form state
  let watchPath = '';
  let embedValue: EmbedConfigValue = { provider: 'local', model: '' };
  let chatValue: ChatConfigValue = { provider: 'local', model: '' };
  let mcpPort = 23847;

  // GPU state
  let availableGpus: Array<{ type: string; label: string; size: string }> = [];
  let selectedGpu: string = 'none'; // 'none' | 'vulkan' | 'cuda'
  let gpuDetecting = false;

  // Download state
  let downloadError = '';

  onMount(async () => {
    try {
      catalog = await nomnom.setupGetCatalog();
      watchPath = catalog.defaults.watchPath;
      embedValue = { provider: 'local', model: catalog.defaults.embedModelId };
      chatValue = { provider: 'local', model: catalog.defaults.chatModelId };
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
    // Only show GPU step when at least one local model is selected
    const hasLocalModel =
      embedValue.provider === 'local' || (chatValue.provider === 'local' && chatValue.model);
    if (hasLocalModel) {
      step = 'gpu';
      gpuDetecting = true;
      try {
        availableGpus = await nomnom.gpuDetect();
        const status = await nomnom.gpuStatus();
        if (status.installed) selectedGpu = status.installed;
      } catch { /* ignore detection errors */ }
      gpuDetecting = false;
    } else {
      step = 'downloading';
      await startDownload();
    }
  }

  async function nextFromGpu() {
    step = 'downloading';
    await startDownload();
  }

  async function startDownload() {
    downloadError = '';
    const isLocal = embedValue.provider === 'local';
    const embedModelId = isLocal ? embedValue.model : '';
    const chatModelId = chatValue.provider === 'local' ? chatValue.model : '';

    try {
      const result = await nomnom.setupStart({
        watchPath,
        embedModelId,
        embedConfig: embedValue,
        chatModelId,
        chatConfig: chatValue,
        mcpPort,
        gpuType: selectedGpu !== 'none' ? selectedGpu : undefined,
      } as Parameters<typeof nomnom.setupStart>[0]);

      if (!result.success) {
        if (result.error === 'cancelled') {
          step = 'embed';
        } else {
          downloadError = result.error ?? 'Setup failed';
          step = 'error';
        }
        return;
      }

      step = 'done';
    } catch (e: any) {
      downloadError = e.message;
      step = 'error';
    }
  }

  async function cancelDownload() {
    await nomnom.setupCancel();
  }

  function retry() {
    step = 'downloading';
    startDownload();
  }

  function goToSettings() {
    setupStatus.set({ needsSetup: false, needsModelDownload: false, checked: true });
    activeTab.set('settings');
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
        <h3 class="setup-step-title">Embedding</h3>
        <p class="setup-step-desc">Creates searchable representations of your documents.</p>
        {#if catalog}
          <EmbedForm bind:value={embedValue} catalog={catalog.embedModels} />
        {/if}
        <div class="setup-nav">
          <button class="setup-btn secondary" onclick={() => step = 'folder'}>Back</button>
          <button class="setup-btn primary" onclick={nextFromEmbed}>Next</button>
        </div>
      </div>

    {:else if step === 'chat'}
      <div class="setup-step">
        <h3 class="setup-step-title">Chat Model</h3>
        <p class="setup-step-desc">For local Q&A with your documents. You can skip this if you only need MCP search.</p>
        {#if catalog}
          <ChatModelForm bind:value={chatValue} catalog={catalog.chatModels} />
        {/if}
        <div class="setup-nav">
          <button class="setup-btn secondary" onclick={() => step = 'embed'}>Back</button>
          <button class="setup-btn primary" onclick={nextFromChat}>
            {embedValue.provider === 'local' || (chatValue.provider === 'local' && chatValue.model) ? 'Download & Finish' : 'Finish'}
          </button>
        </div>
      </div>

    {:else if step === 'gpu'}
      <div class="setup-step">
        <h3 class="setup-step-title">GPU Acceleration</h3>
        <p class="setup-step-desc">
          Speed up AI inference with your GPU. This downloads a small binary — the app works fine on CPU without it.
        </p>

        {#if gpuDetecting}
          <div class="gpu-detecting">
            <div class="setup-spinner small"></div>
            <span>Detecting GPUs...</span>
          </div>
        {:else}
          <div class="gpu-options">
            <label class="gpu-option">
              <input type="radio" name="gpu" value="none" bind:group={selectedGpu} />
              <div class="gpu-option-body">
                <span class="gpu-option-label">CPU only</span>
                <span class="gpu-option-desc">No extra download needed</span>
              </div>
            </label>

            {#each availableGpus as gpu}
              <label class="gpu-option">
                <input type="radio" name="gpu" value={gpu.type} bind:group={selectedGpu} />
                <div class="gpu-option-body">
                  <span class="gpu-option-label">{gpu.label}</span>
                  <span class="gpu-option-desc">Download {gpu.size}</span>
                </div>
              </label>
            {/each}

            {#if availableGpus.length === 0}
              <p class="gpu-no-gpu">No compatible GPU detected. You can add GPU support later in Settings.</p>
            {/if}
          </div>
        {/if}

        <div class="setup-nav">
          <button class="setup-btn secondary" onclick={() => step = 'chat'}>Back</button>
          <button class="setup-btn primary" onclick={nextFromGpu} disabled={gpuDetecting}>
            {selectedGpu !== 'none' ? 'Download & Finish' : 'Skip & Finish'}
          </button>
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
        <button class="setup-btn secondary" onclick={cancelDownload}>Cancel</button>
      </div>

    {:else if step === 'done'}
      <div class="setup-center">
        <div class="setup-done-icon">✓</div>
        <h3 class="setup-title">All Set!</h3>
        <p class="setup-subtitle">
          Models are downloaded and ready. Your documents will be indexed automatically.
        </p>
        {#if $setupGpuFailed}
          <div class="setup-gpu-notice">
            GPU acceleration ({$setupGpuFailed.gpuType.toUpperCase()}) could not be activated — your system may not be compatible. The app is running on CPU. You can retry from Settings.
          </div>
        {/if}
        <button class="setup-btn primary" onclick={finish}>Start Using NomNomDrive</button>
      </div>

    {:else if step === 'error'}
      <div class="setup-center">
        <div class="setup-error-icon">!</div>
        <h3 class="setup-title">Setup Error</h3>
        <p class="setup-error-text">{downloadError}</p>
        <div class="setup-error-actions">
          <button class="setup-btn secondary" onclick={goToSettings}>Change Model</button>
          <button class="setup-btn primary" onclick={retry}>Retry</button>
        </div>
      </div>
    {/if}

  </div>
</div>

<style>
  .setup-gpu-notice {
    background: rgba(229, 161, 0, 0.1);
    border: 1px solid rgba(229, 161, 0, 0.3);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 16px;
    color: var(--yellow, #e5a100);
    font-size: 13px;
    line-height: 1.5;
    text-align: center;
  }

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

  .setup-error-actions {
    display: flex;
    gap: 10px;
    margin-top: 4px;
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

  /* GPU step */
  .gpu-detecting {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-secondary);
    padding: 12px 0;
  }

  .setup-spinner.small {
    width: 16px;
    height: 16px;
    border-width: 2px;
  }

  .gpu-options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .gpu-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: border-color var(--transition);
  }

  .gpu-option:has(input:checked) {
    border-color: var(--accent);
  }

  .gpu-option input[type='radio'] {
    accent-color: var(--accent);
    margin: 0;
  }

  .gpu-option-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .gpu-option-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .gpu-option-desc {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .gpu-no-gpu {
    font-size: 11px;
    color: var(--text-secondary);
    margin: 4px 0 0;
  }
</style>
