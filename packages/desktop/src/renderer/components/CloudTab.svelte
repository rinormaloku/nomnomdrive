<script lang="ts">
  import { nomnom } from '../lib/nomnom';
  import { showToast, cloudStatus } from '../lib/stores';
  import { Copy } from 'lucide-svelte';

  let connecting = false;
  let disconnecting = false;
  let loginError = '';
  let showAdvanced = false;
  let customServerUrl = '';

  $: isCloud = $cloudStatus?.mode === 'cloud';

  async function connect() {
    connecting = true;
    loginError = '';
    try {
      const serverUrl = showAdvanced && customServerUrl.trim() ? customServerUrl.trim() : undefined;
      const result = await nomnom.cloudLogin(serverUrl);
      if (!result.success) {
        loginError = result.error ?? 'Login failed';
      } else {
        showToast('Connected to cloud');
      }
    } finally {
      connecting = false;
    }
  }

  async function disconnect() {
    disconnecting = true;
    try {
      await nomnom.cloudLogout();
      showToast('Disconnected from cloud');
    } finally {
      disconnecting = false;
    }
  }
</script>

<div class="cloud-intro">
  <p>Access your documents from anywhere by connecting to the NomNomDrive cloud MCP server.</p>
</div>

<div class="cloud-body">
  {#if $cloudStatus === null}
    <div class="cloud-loading">Loading…</div>
  {:else}
    <div class="cloud-status-card">
      <div class="cloud-status-row">
        <span class="cloud-label">Mode</span>
        <span class="cloud-badge {isCloud ? 'cloud' : 'local'}">{isCloud ? 'cloud' : 'local'}</span>
      </div>
      {#if isCloud && $cloudStatus.serverUrl}
        <div class="cloud-status-row">
          <span class="cloud-label">Server</span>
          <span class="cloud-value">{$cloudStatus.serverUrl}</span>
        </div>
        <div class="cloud-status-row">
          <span class="cloud-label">Auth</span>
          <span class="cloud-value">{$cloudStatus.hasCredentials ? 'Credentials saved' : 'Not authenticated'}</span>
        </div>
        <div class="cloud-status-row cloud-mcp-row">
          <span class="cloud-label">MCP URL</span>
          <div class="cloud-mcp-url">
            <code>{$cloudStatus.serverUrl}/mcp</code>
            <button class="cloud-mcp-copy" title="Copy MCP URL" onclick={() => { navigator.clipboard.writeText(`${$cloudStatus!.serverUrl}/mcp`).then(() => showToast('MCP URL copied')); }}>
              <Copy size={12} />
            </button>
          </div>
        </div>
      {/if}
    </div>

    {#if isCloud}
      <button class="cloud-disconnect-btn" onclick={disconnect} disabled={disconnecting}>
        {disconnecting ? 'Disconnecting…' : 'Disconnect from cloud'}
      </button>
    {:else}
      <div class="cloud-mascot">
        <svg viewBox="0 0 344 344" xmlns="http://www.w3.org/2000/svg" width="64" height="64">
          <g>
            <path d="m172 334c-89.6 0-162-72.4-162-162 0-89.6 72.4-162 162-162 89.6 0 162 72.4 162 162 0 89.6-72.4 162-162 162z" fill="#222" />
            <path d="m135.9 285.1c-27.9-4.1-54-12.1-77.6-27.2-32.5-20.9-46.7-50.1-40.5-88.6 10.2-63.4 43.9-109.1 105.1-130 87.4-29.8 177.9 21.8 200 112 3.9 16 6 32.2 3.8 48.5-3.4 25.2-18.4 42.7-38.6 56.4-25.8 17.5-54.9 25.9-85.5 29.7-22.1 2.7-44.2 2.3-66.7-0.8zm-62.7-162.4c-13.7 14.4-19 32.1-20.3 51.4-1.9 25.8 9 44.3 31.7 56.2 3.5 1.8 7.2 3.5 10.9 4.9 30.1 11.2 61.5 12.6 93.1 11.2 22.7-0.9 45.1-4.3 66.1-13.7 27.9-12.6 39.4-32.8 36.2-63.2-2.9-27.5-15.2-49.1-40.5-61.9-7.2-3.6-15-6.6-22.8-8.4-33.1-7.8-66.4-7.8-99.8-2.5-20.4 3.3-39.2 10.3-54.6 26z" fill="#fcfcfc" />
            <path d="m73.4 122.4c15.2-15.4 34-22.4 54.4-25.7 33.4-5.3 66.7-5.3 99.8 2.5 7.8 1.8 15.6 4.8 22.8 8.4 25.3 12.8 37.6 34.4 40.5 61.9 3.2 30.4-8.3 50.6-36.2 63.2-21 9.4-43.4 12.8-66.1 13.7-31.6 1.4-63 0-93.1-11.2-3.7-1.4-7.4-3.1-10.9-4.9-22.7-11.9-33.6-30.4-31.7-56.2 1.3-19.3 6.6-37 20.5-51.7z" fill="#010202" />
            <path d="m95.6 169.8c10.3-19.6 35.4-21.6 47.3-4 1.7 2.6 2.7 5.8 3.2 8.8 0.6 3.5-1.2 6.2-4.8 7.1-3.4 1-6.2-0.3-7.9-3.5-0.5-0.9-0.8-1.9-1.3-2.7-2.6-4.6-6.6-7-11.8-7-5.3 0-9.6 2.4-11.8 7.1-2 4.5-4.4 7.6-9.7 6-4.1-1.3-5.1-5.2-3.2-11.8z" fill="#4bb3ec" />
            <path d="m224.9 153.9c9.9 0.7 17.2 5 22.1 13.1 1.1 1.9 2 3.9 2.5 6 0.9 3.9-0.3 7.1-4.2 8.5-4 1.5-7.3 0.2-8.9-4-2.3-5.7-6.5-8.9-12.5-9-6.1-0.1-10.4 3.1-12.8 8.7-1.6 4.1-4.6 5.8-8.7 4.4-4.3-1.4-5.1-4.9-4.4-8.9 1.7-8.9 11.7-17.4 21.9-18.6 1.5-0.2 3-0.1 5-0.2z" fill="#4bb3ec" />
          </g>
        </svg>
        <p class="cloud-mascot-text">Your data stays on this device</p>
      </div>
      <div class="cloud-connect-section">
        <button class="cloud-connect-btn" onclick={connect} disabled={connecting}>
          {#if connecting}
            <span class="cloud-connect-spinner"></span>
            Waiting for browser authentication…
          {:else}
            Connect to cloud
          {/if}
        </button>

        {#if loginError}
          <p class="cloud-error">{loginError}</p>
        {/if}

        <button class="cloud-advanced-toggle" onclick={() => (showAdvanced = !showAdvanced)}>
          {showAdvanced ? '▾' : '▸'} Advanced
        </button>

        {#if showAdvanced}
          <div class="cloud-advanced-panel">
            <label class="cloud-server-label" for="cloud-server-input">Server URL</label>
            <input
              id="cloud-server-input"
              class="cloud-server-input"
              type="text"
              placeholder="https://cloud.nomnomdrive.com"
              bind:value={customServerUrl}
              disabled={connecting}
            />
            <p class="cloud-hint">Leave blank to use the default cloud. Set to e.g. <code>http://localhost:3030</code> for a local dev instance.</p>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
