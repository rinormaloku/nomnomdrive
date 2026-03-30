<script lang="ts">
  import { config, updateReady, cloudStatus } from '../lib/stores';
  import { Copy, Check } from 'lucide-svelte';

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
        <span class="status-copy-icon">
          {#if localCopied}
            <Check size={10} />
          {:else}
            <Copy size={10} />
          {/if}
        </span>
      </button>
    {:else}
      <span class="mcp-indicator">
        <span class="mcp-dot"></span>
        <span>MCP</span>
      </span>
    {/if}

    {#if cloudMcpUrl}
      <span class="status-sep">&middot;</span>
      <button class="status-url-btn status-cloud-btn" class:copied={cloudCopied} onclick={copyCloud} title="Copy cloud MCP URL">
        <span class="cloud-dot"></span>
        <span class="status-url-text">{cloudMcpUrl}</span>
        <span class="status-copy-icon">
          {#if cloudCopied}
            <Check size={10} />
          {:else}
            <Copy size={10} />
          {/if}
        </span>
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
