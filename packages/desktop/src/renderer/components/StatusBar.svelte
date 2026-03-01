<script lang="ts">
  import { config, updateReady } from '../lib/stores';
</script>

<div class="status-bar">
  <div class="status-left">
    <span class="mcp-indicator">
      <span class="mcp-dot" class:active={$config.mcpPort !== null}></span>
      <span>MCP</span>
      {#if $config.mcpPort}
        <span class="mcp-port">:{$config.mcpPort}</span>
      {/if}
    </span>
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
