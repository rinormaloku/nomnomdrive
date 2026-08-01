<script lang="ts">
  import { onMount } from 'svelte';
  import { nomnom } from '../lib/nomnom';
  import { showToast, cloudStatus, tunnelStatus } from '../lib/stores';
  import { ChevronDown, Cloud, Copy } from 'lucide-svelte';
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
  // Collapsed by default — the card is a settings surface, not a daily-use one.
  let expanded = false;

  $: isCloud = $cloudStatus?.mode === 'cloud';
  // Collapsed header summary: the tunnel state when connected, a muted hint otherwise.
  $: summaryState = isCloud ? $tunnelStatus : 'disconnected';
  $: summaryLabel = isCloud ? (AUTH_LABELS[$tunnelStatus] ?? 'Unknown') : 'Not connected';

  // The "connect to cloud" promo in McpSection lives in the same pane; it opens
  // this card instead of just scrolling to a collapsed header.
  onMount(() => {
    const open = () => (expanded = true);
    window.addEventListener('nomnom:expand-cloud-card', open);
    return () => window.removeEventListener('nomnom:expand-cloud-card', open);
  });

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

  function copyCloudMcpUrl() {
    const url = $cloudStatus?.serverUrl;
    if (!url) return;
    navigator.clipboard.writeText(`${url}/mcp`).then(() => showToast('MCP URL copied'));
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

<div class="home-card cloud-card" id="cloud-card" class:expanded>
  <button
    class="cloud-card-head"
    type="button"
    aria-expanded={expanded}
    aria-controls="cloud-card-body"
    onclick={() => (expanded = !expanded)}
  >
    <span class="cloud-card-icon">
      <Cloud size={16} />
    </span>
    <span class="cloud-card-head-text">
      <span class="cloud-card-title">Cloud tunnel</span>
    </span>
    <span class="cloud-head-status">
      <span class="cloud-status-dot {summaryState}"></span>
      <span class="cloud-head-status-label">{summaryLabel}</span>
    </span>
    <span class="cloud-card-chevron">
      <ChevronDown size={14} />
    </span>
  </button>

  {#if expanded}
    <div class="cloud-card-body" id="cloud-card-body">
      <p class="cloud-card-desc">Access your docs from anywhere.</p>

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
                <button class="cloud-mcp-copy" title="Copy MCP URL" onclick={copyCloudMcpUrl}>
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
  {/if}
</div>
