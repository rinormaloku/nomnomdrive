<script lang="ts">
  import { onMount } from 'svelte';
  import { activeTab, showToast } from '../lib/stores';
  import { nomnom } from '../lib/nomnom';
  import EmbedForm from './settings/EmbedForm.svelte';
  import type { EmbedConfigValue, ChatConfigValue } from '../lib/types';
  import ChatModelForm from './settings/ChatModelForm.svelte';
  import WatchFoldersForm from './settings/WatchFoldersForm.svelte';

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
  let watchPaths: string[] = [];
  let mcpPort = 23847;

  // GPU state
  let gpuInstalled: string | null = null;
  let gpuAvailable: Array<{ type: string; label: string; size: string }> = [];
  let gpuInstalling = false;
  let gpuRemoving = false;
  let gpuActiveBackend: string | null = null;

  onMount(async () => {
    try {
      const [cfg, catalog] = await Promise.all([
        nomnom.configGet() as Promise<AppConfig>,
        nomnom.setupGetCatalog(),
      ]);
      appConfig = cfg;
      embedCatalog = catalog.embedModels;
      chatCatalog = catalog.chatModels;

      // Populate form from config
      embedValue = cfg.embed ?? { provider: 'local', model: cfg.model.localEmbed };
      chatValue = cfg.chat ?? { provider: 'local', model: cfg.model.localChat ?? '' };
      watchPaths = [...cfg.watch.paths];
      mcpPort = cfg.mcp.port;

      // Load GPU status
      const [gpuStatus, detected, activeBackend] = await Promise.all([
        nomnom.gpuStatus(),
        nomnom.gpuDetect(),
        nomnom.gpuActiveBackend(),
      ]);
      gpuInstalled = gpuStatus.installed;
      gpuAvailable = detected;
      gpuActiveBackend = activeBackend.backend;
    } finally {
      loading = false;
    }
  });

  async function installGpu(gpuType: string) {
    gpuInstalling = true;
    try {
      const result = await nomnom.gpuInstall(gpuType);
      if (result.success) {
        gpuInstalled = gpuType;
        showToast(`GPU acceleration (${gpuType}) installed — restart to activate`);
      } else {
        showToast(`GPU install failed: ${result.error}`, 4000);
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

      <section class="section">
        <h3 class="section-title">Embedding</h3>
        <p class="section-desc">Creates searchable representations of your documents.</p>
        <EmbedForm bind:value={embedValue} catalog={embedCatalog} />
      </section>

      <div class="divider"></div>

      <section class="section">
        <h3 class="section-title">Chat Model</h3>
        <p class="section-desc">For Q&A with your documents in the Chat tab.</p>
        <ChatModelForm bind:value={chatValue} catalog={chatCatalog} />
      </section>

      <div class="divider"></div>

      <section class="section">
        <h3 class="section-title">GPU Acceleration</h3>
        <p class="section-desc">Use your GPU for faster inference. Downloads a one-time binary.</p>

        {#if gpuActiveBackend}
          <div class="gpu-runtime">
            Running on: <span class="gpu-runtime-value">{gpuActiveBackend.toUpperCase()}</span>
          </div>
        {/if}

        {#if gpuInstalled}
          <div class="gpu-status">
            <span class="gpu-badge">{gpuInstalled.toUpperCase()}</span>
            <span class="gpu-active">Active</span>
            <button class="btn-link danger" onclick={removeGpu} disabled={gpuRemoving}>
              {gpuRemoving ? 'Removing...' : 'Remove'}
            </button>
          </div>
        {:else if gpuAvailable.length > 0}
          <div class="gpu-install-options">
            {#each gpuAvailable as gpu}
              <div class="gpu-install-row">
                <div>
                  <span class="gpu-install-label">{gpu.label}</span>
                  <span class="gpu-install-size">{gpu.size}</span>
                </div>
                <button class="btn small" onclick={() => installGpu(gpu.type)} disabled={gpuInstalling}>
                  {gpuInstalling ? 'Installing...' : 'Install'}
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="gpu-none">No compatible GPU detected on this system.</p>
        {/if}
      </section>

      <div class="divider"></div>

      <section class="section">
        <h3 class="section-title">Watched Folders</h3>
        <p class="section-desc">NomNomDrive indexes documents in these folders.</p>
        <WatchFoldersForm bind:paths={watchPaths} />
      </section>

      <div class="divider"></div>

      <section class="section">
        <h3 class="section-title">Advanced</h3>
        <div class="field-row">
          <label class="field-label" for="mcp-port">MCP Server Port</label>
          <input
            id="mcp-port"
            class="port-input"
            type="number"
            bind:value={mcpPort}
            min="1024"
            max="65535"
          />
        </div>
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
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 3px;
  }

  .section-desc {
    font-size: 11px;
    color: var(--text-secondary);
    margin: 0 0 10px;
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 0 -18px;
  }

  .field-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .field-label {
    font-size: 12px;
    color: var(--text);
    flex: 1;
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

  /* GPU section */
  .gpu-runtime {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .gpu-runtime-value {
    font-weight: 700;
    color: var(--green);
  }

  .gpu-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
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

  .gpu-active {
    color: var(--green);
    font-weight: 600;
  }

  .btn-link {
    background: none;
    border: none;
    font-size: 11px;
    font-family: var(--font);
    cursor: pointer;
    padding: 0;
    margin-left: auto;
  }

  .btn-link.danger {
    color: var(--red);
  }

  .btn-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .gpu-install-options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .gpu-install-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .gpu-install-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .gpu-install-size {
    font-size: 11px;
    color: var(--text-secondary);
    margin-left: 6px;
  }

  .btn.small {
    padding: 4px 12px;
    font-size: 11px;
  }

  .gpu-none {
    font-size: 11px;
    color: var(--text-secondary);
    margin: 0;
  }
</style>
