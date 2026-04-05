<script lang="ts">
  import { onMount } from 'svelte';
  import { showToast } from '../lib/stores';
  import { nomnom } from '../lib/nomnom';
  import EmbedForm from './settings/EmbedForm.svelte';
  import type { EmbedConfigValue, ChatConfigValue } from '../lib/types';
  import ChatModelForm from './settings/ChatModelForm.svelte';
  import WatchFoldersForm from './settings/WatchFoldersForm.svelte';
  import ToggleSwitch from './settings/ToggleSwitch.svelte';
  import { Settings, Sparkles } from 'lucide-svelte';

  type AppConfig = {
    mode: string;
    watch: { paths: string[]; glob: string };
    model: { localEmbed: string; localChat: string };
    embed?: EmbedConfigValue;
    chat?: ChatConfigValue;
    mcp: { port: number };
  };

  type CatalogEntry = { id: string; label: string; size: string; recommended: boolean };

  let loading = true;
  let saving = false;
  let appConfig: AppConfig | null = null;
  let embedCatalog: CatalogEntry[] = [];
  let chatCatalog: CatalogEntry[] = [];

  // Form state
  let embedValue: EmbedConfigValue = { provider: 'local', model: '' };
  let chatValue: ChatConfigValue = { provider: 'local', model: '' };
  let chatEnabled = false;
  let lastChatValue: ChatConfigValue = { provider: 'local', model: '' };
  let watchPaths: string[] = [];
  let mcpPort = 23847;

  // Launch at startup
  let openAtLogin = true;

  // GPU state
  let gpuInstalled: string | null = null;
  let gpuValidated: boolean | undefined = undefined;
  let gpuAvailable: Array<{ type: string; label: string; size: string }> = [];
  let gpuInstalling = false;
  let gpuRemoving = false;
  let gpuActiveBackend: string | null = null;

  onMount(async () => {
    try {
      const [cfg, catalog, loginSetting] = await Promise.all([
        nomnom.configGet() as Promise<AppConfig>,
        nomnom.setupGetCatalog(),
        nomnom.getOpenAtLogin(),
      ]);
      appConfig = cfg;
      embedCatalog = catalog.embedModels;
      chatCatalog = catalog.chatModels;
      openAtLogin = loginSetting;

      // Populate form from config
      embedValue = cfg.embed ?? { provider: 'local', model: cfg.model.localEmbed };
      chatValue = cfg.chat ?? { provider: 'local', model: cfg.model.localChat ?? '' };

      // Determine if chat is enabled (not the disabled state)
      const isDisabled = chatValue.provider === 'local' && !chatValue.model;
      chatEnabled = !isDisabled;
      if (chatEnabled) {
        lastChatValue = { ...chatValue };
      } else {
        // Default restore value
        lastChatValue = { provider: 'local', model: chatCatalog[0]?.id ?? '' };
      }

      watchPaths = [...cfg.watch.paths];
      mcpPort = cfg.mcp.port;

      // Load GPU status
      const [gpuStatus, detected, activeBackend] = await Promise.all([
        nomnom.gpuStatus(),
        nomnom.gpuDetect(),
        nomnom.gpuActiveBackend(),
      ]);
      gpuInstalled = gpuStatus.installed;
      gpuValidated = gpuStatus.validated;
      gpuAvailable = detected;
      gpuActiveBackend = activeBackend.backend;
    } finally {
      loading = false;
    }
  });

  function handleChatToggle() {
    if (chatEnabled) {
      // Restoring — use last known value
      chatValue = { ...lastChatValue };
    } else {
      // Disabling — save current value for later restore
      lastChatValue = { ...chatValue };
      chatValue = { provider: 'local', model: '' };
    }
  }

  async function handleOpenAtLoginChange() {
    try {
      await nomnom.setOpenAtLogin(openAtLogin);
    } catch (e: unknown) {
      showToast(`Failed: ${e instanceof Error ? e.message : String(e)}`, 4000);
    }
  }

  async function installGpu(gpuType: string) {
    gpuInstalling = true;
    try {
      const result = await nomnom.gpuInstall(gpuType);
      if (result.success) {
        gpuInstalled = gpuType;
        gpuValidated = true;
        showToast(`GPU acceleration (${gpuType}) installed and verified — restart to activate`);
      } else {
        gpuInstalled = null;
        gpuValidated = undefined;
        showToast(`GPU binary is not compatible with your system. ${result.error ?? 'Using CPU instead.'}`, 6000);
      }
    } catch (e: unknown) {
      showToast(`GPU install failed: ${e instanceof Error ? e.message : String(e)}`, 4000);
    } finally {
      gpuInstalling = false;
    }
  }

  async function removeGpu() {
    if (!gpuInstalled) return;
    gpuRemoving = true;
    try {
      const result = await nomnom.gpuRemove(gpuInstalled);
      if (result.success) {
        gpuInstalled = null;
        gpuValidated = undefined;
        showToast('GPU acceleration removed — restart to use CPU');
      }
    } finally {
      gpuRemoving = false;
    }
  }

  async function save() {
    if (!appConfig) return;
    saving = true;
    try {
      const updates: Partial<AppConfig> = {
        embed: embedValue,
        chat: chatValue,
        model: {
          localEmbed: embedValue.provider === 'local' ? embedValue.model : appConfig.model.localEmbed,
          localChat: chatValue.provider === 'local' ? chatValue.model : appConfig.model.localChat,
        },
        watch: { ...appConfig.watch, paths: watchPaths },
        mcp: { port: mcpPort },
      };
      const embedChanged =
        embedValue.provider !== (appConfig.embed?.provider ?? 'local') ||
        embedValue.model !== (appConfig.embed?.model ?? appConfig.model.localEmbed);

      const result = await nomnom.configSave(updates);
      if (embedChanged) {
        showToast('Settings saved — downloading new model and re-indexing all documents. This may take a while.', 6000);
      } else if (result.restartRequired) {
        showToast('Settings saved — restart to apply changes', 4000);
      } else {
        showToast('Settings saved');
      }
    } catch (e: unknown) {
      showToast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, 4000);
    } finally {
      saving = false;
    }
  }
</script>

<div class="settings-panel">

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading...</span>
    </div>
  {:else}
    <div class="settings-body">

      <!-- ── Models ─────────────────────────────────── -->
      <section class="section">
        <h3 class="section-title"><Sparkles size={13} /> Models</h3>
        <p class="section-desc">Choose which models power search and chat.</p>

        <div class="models-grid">
          <div class="model-col">
            <h4 class="subsection-title">Embedding</h4>
            <p class="subsection-desc">Searchable representations of your documents.</p>
            <div class="section-card">
              <EmbedForm bind:value={embedValue} catalog={embedCatalog} />
            </div>
          </div>

          <div class="model-col">
            <div class="subsection-title-row">
              <h4 class="subsection-title">Chat</h4>
              <ToggleSwitch bind:checked={chatEnabled} on:change={handleChatToggle} />
            </div>
            <p class="subsection-desc">Q&A with your documents in the Chat tab.</p>
            {#if chatEnabled}
              <div class="section-card">
                <ChatModelForm bind:value={chatValue} catalog={chatCatalog} />
              </div>
            {:else}
              <p class="disabled-hint">Disabled — searchable via MCP tools only.</p>
            {/if}
          </div>
        </div>
      </section>

      <div class="divider"></div>

      <!-- ── General ────────────────────────────────── -->
      <section class="section">
        <h3 class="section-title"><Settings size={13} /> General</h3>
        <div class="section-card general-card">
          <div class="setting-row">
            <span class="setting-label">Launch at startup</span>
            <ToggleSwitch bind:checked={openAtLogin} on:change={handleOpenAtLoginChange} />
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <div class="setting-label-group">
              <span class="setting-label">GPU acceleration</span>
              {#if gpuActiveBackend}
                <span class="setting-hint">Running on <strong>{gpuActiveBackend.toUpperCase()}</strong></span>
              {/if}
            </div>
            {#if gpuInstalled}
              <div class="gpu-inline">
                <span class="gpu-badge">{gpuInstalled.toUpperCase()}</span>
                <button class="btn-link danger" onclick={removeGpu} disabled={gpuRemoving}>
                  {gpuRemoving ? 'Removing...' : 'Remove'}
                </button>
              </div>
            {:else if gpuAvailable.length > 0}
              <div class="gpu-inline">
                {#each gpuAvailable as gpu}
                  <button class="btn small" onclick={() => installGpu(gpu.type)} disabled={gpuInstalling}>
                    {gpuInstalling ? 'Installing...' : `Install ${gpu.label}`}
                  </button>
                {/each}
              </div>
            {:else}
              <span class="setting-hint">No compatible GPU</span>
            {/if}
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <label class="setting-label" for="mcp-port">MCP server port</label>
            <input
              id="mcp-port"
              class="port-input"
              type="number"
              bind:value={mcpPort}
              min="1024"
              max="65535"
            />
          </div>
        </div>

        <h4 class="subsection-title general-subsection">Watched folders</h4>
        <p class="subsection-desc">NomNomDrive indexes documents in these folders.</p>
        <WatchFoldersForm bind:paths={watchPaths} />
      </section>

    </div>

    <div class="settings-footer">
      <button class="btn primary" onclick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  {/if}

</div>

<style>
  .settings-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex: 1;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--bg3);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 18px;
  }

  .section {
    padding: 16px 0;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 3px;
  }

  .section-desc {
    font-size: 11px;
    color: var(--text-secondary);
    margin: 0 0 10px;
  }

  .models-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .model-col {
    min-width: 0;
  }

  .subsection-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 2px;
  }

  .subsection-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
  }

  .subsection-desc {
    font-size: 11px;
    color: var(--text-secondary);
    margin: 0 0 8px;
  }

  .general-subsection {
    margin-top: 16px;
  }

  .section-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
  }

  .disabled-hint {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 0 -18px;
  }

  .general-card {
    padding: 0;
    max-width: 360px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
  }

  .setting-label {
    font-size: 12px;
    color: var(--text);
  }

  .setting-divider {
    height: 1px;
    background: var(--border);
  }

  .port-input {
    width: 90px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    outline: none;
    text-align: right;
  }

  .port-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-light);
  }

  .settings-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .btn {
    padding: 7px 18px;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    transition: background var(--transition), opacity var(--transition);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.primary {
    background: var(--accent);
    color: #fff;
  }

  .btn.primary:not(:disabled):hover {
    background: var(--accent-hover);
  }

  .setting-label-group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .setting-hint {
    font-size: 10px;
    color: var(--text-secondary);
  }

  .setting-hint strong {
    color: var(--green);
  }

  /* GPU inline (inside General card) */
  .gpu-inline {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .gpu-badge {
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .btn-link {
    background: none;
    border: none;
    font-size: 11px;
    font-family: var(--font);
    cursor: pointer;
    padding: 0;
  }

  .btn-link.danger {
    color: var(--red);
  }

  .btn-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.small {
    padding: 4px 12px;
    font-size: 11px;
  }
</style>
