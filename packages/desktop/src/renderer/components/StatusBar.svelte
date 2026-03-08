<script lang="ts">
  import { config, updateReady, cloudStatus } from '../lib/stores';

  $: localMcpUrl = $config.mcpPort ? `http://localhost:${$config.mcpPort}/mcp` : null;
  $: cloudMcpUrl = $cloudStatus?.mode === 'cloud' && $cloudStatus.serverUrl
    ? `${$cloudStatus.serverUrl}/mcp`
    : null;

  let localCopied = false;
  let cloudCopied = false;

  function copyLocal() {
    if (!localMcpUrl) return;
    navigator.clipboard.writeText(localMcpUrl).then(() => {
      localCopied = true;
      setTimeout(() => { localCopied = false; }, 1500);
    });
  }

  function copyCloud() {
    if (!cloudMcpUrl) return;
    navigator.clipboard.writeText(cloudMcpUrl).then(() => {
      cloudCopied = true;
      setTimeout(() => { cloudCopied = false; }, 1500);
    });
  }
</script>

<div class="status-bar">
  <div class="status-left">
    {#if localMcpUrl}
      <button class="status-url-btn" class:copied={localCopied} onclick={copyLocal} title="Copy local MCP URL">
        <span class="mcp-dot active"></span>
        <span class="status-url-text">{localMcpUrl}</span>
        <svg class="status-copy-icon" width="10" height="10" viewBox="0 0 16 16" fill="none">
          {#if localCopied}
            <path d="M3 8L6.5 11.5L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          {:else}
            <rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.3" />
            <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3" />
          {/if}
        </svg>
      </button>
    {:else}
      <span class="mcp-indicator">
        <span class="mcp-dot"></span>
        <span>MCP</span>
      </span>
    {/if}

    {#if cloudMcpUrl}
      <span class="status-sep">·</span>
      <button class="status-url-btn status-cloud-btn" class:copied={cloudCopied} onclick={copyCloud} title="Copy cloud MCP URL">
        <span class="cloud-dot"></span>
        <span class="status-url-text">{cloudMcpUrl}</span>
        <svg class="status-copy-icon" width="10" height="10" viewBox="0 0 16 16" fill="none">
          {#if cloudCopied}
            <path d="M3 8L6.5 11.5L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          {:else}
            <rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.3" />
            <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3" />
          {/if}
        </svg>
      </button>
    {/if}
  </div>
  <div class="status-right">
    {#if $updateReady}
      <button class="update-btn" onclick={() => window.nomnom.installUpdate()}>
        Restart to update
      </button>
    {:else}
      <span class="version-label">NomNomDrive v0.1.0</span>
    {/if}
  </div>
</div>
