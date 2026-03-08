<script lang="ts">
  import { nomnom } from '../lib/nomnom';
  import { showToast, cloudStatus } from '../lib/stores';

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
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.3" />
                <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3" />
              </svg>
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
              placeholder="https://cloud.nomnomdrive.app"
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
