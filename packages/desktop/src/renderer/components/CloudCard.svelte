<script lang="ts">
  import { nomnom } from '../lib/nomnom';
  import { showToast, cloudStatus, tunnelStatus } from '../lib/stores';
  import { Cloud, Copy } from 'lucide-svelte';
  import Bot from './Bot.svelte';

  const AUTH_LABELS: Record<string, string> = {
    connecting: 'Connecting…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    'auth-expired': 'Session expired',
    disconnected: 'Disconnected',
  };

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

  // Re-run OAuth against the server we're already configured for (not the default),
  // minting fresh tokens after a session expiry.
  async function reconnect() {
    connecting = true;
    loginError = '';
    try {
      const result = await nomnom.cloudLogin($cloudStatus?.serverUrl ?? undefined);
      if (!result.success) {
        loginError = result.error ?? 'Reconnect failed';
      } else {
        showToast('Reconnected to cloud');
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

<div class="home-card cloud-card" id="cloud-card">
  <div class="cloud-card-head">
    <span class="cloud-card-icon">
      <Cloud size={16} />
    </span>
    <div class="cloud-card-head-text">
      <h3 class="cloud-card-title">Use from anywhere</h3>
      <p class="cloud-card-desc">
        Let agents on other devices — claude.ai, ChatGPT, a second laptop — reach your documents
        through a secure tunnel. The documents themselves never leave this machine.
      </p>
    </div>
    <span class="cloud-badge {isCloud ? 'cloud' : 'local'}">{isCloud ? 'cloud' : 'local'}</span>
  </div>

  {#if $cloudStatus === null}
    <div class="cloud-loading">Loading…</div>
  {:else if isCloud}
    {#if $cloudStatus.serverUrl}
      <div class="cloud-status-card">
        <div class="cloud-status-row">
          <span class="cloud-label">Server</span>
          <span class="cloud-value">{$cloudStatus.serverUrl}</span>
        </div>
        <div class="cloud-status-row">
          <span class="cloud-label">Connection</span>
          {#if $tunnelStatus === 'auth-expired'}
            <span class="cloud-conn-inline">
              <span class="cloud-status-dot {$tunnelStatus}"></span>
              <span class="cloud-value">Session expired</span>
              <button class="cloud-reconnect-btn" onclick={reconnect} disabled={connecting}>
                {connecting ? 'Reconnecting…' : 'Reconnect'}
              </button>
            </span>
          {:else}
            <span class="cloud-conn-inline">
              <span class="cloud-status-dot {$tunnelStatus}"></span>
              <span class="cloud-value">{AUTH_LABELS[$tunnelStatus] ?? 'Unknown'}</span>
            </span>
          {/if}
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
      </div>
    {/if}

    <button class="cloud-disconnect-btn" onclick={disconnect} disabled={disconnecting}>
      {disconnecting ? 'Disconnecting…' : 'Disconnect from cloud'}
    </button>
  {:else}
    <div class="cloud-connect-section">
      <div class="cloud-connect-row">
        <button class="cloud-connect-btn" onclick={connect} disabled={connecting}>
          {#if connecting}
            <span class="cloud-connect-spinner"></span>
            Waiting for browser authentication…
          {:else}
            Connect to cloud
          {/if}
        </button>
        <span class="cloud-mascot-inline">
          <Bot size={26} blink />
          <span class="cloud-mascot-text">Your data stays on this device</span>
        </span>
      </div>

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
          <p class="cloud-hint">
            Leave blank to use the default cloud. Set to e.g.
            <code>http://localhost:3030</code> for a local dev instance.
          </p>
        </div>
      {/if}
    </div>
  {/if}
</div>
