<script lang="ts">
  import { config, cloudStatus } from '../lib/stores';
  import { nomnom } from '../lib/nomnom';
  import { showToast } from '../lib/stores';
  import { Copy, Cloud, ChevronRight } from 'lucide-svelte';

  $: isCloud = $cloudStatus?.mode === 'cloud' && !!$cloudStatus?.serverUrl;
  $: cloudMcpUrl = isCloud ? `${$cloudStatus!.serverUrl}/mcp` : null;

  const mcpCommands: Record<string, string> = {
    'claude-code': 'claude mcp add --transport http nomnomdrive {URL}',
    opencode: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "nomnomdrive": {
      "type": "remote",
      "url": "{URL}"
    }
  }
}`,
    windsurf: `{
  "mcpServers": {
    "nomnomdrive": {
      "url": "{URL}"
    }
  }
}`,
  };

  type BtnState = 'idle' | 'loading' | 'installed' | 'not-found' | 'error';
  let btnStates: Record<string, BtnState> = {};

  function port() {
    return $config.mcpPort || 23847;
  }

  function mcpEndpoint() {
    return `http://localhost:${port()}/mcp`;
  }

  // When connected to cloud, present the cloud URL everywhere so clients (local or
  // remote) get a single endpoint instead of two competing URLs.
  function activeEndpoint() {
    return isCloud && cloudMcpUrl ? cloudMcpUrl : mcpEndpoint();
  }

  async function handleInstall(client: string) {
    if (client === 'vscode') {
      const vsConfig = JSON.stringify({ type: 'http', url: activeEndpoint() });
      const link =
        'https://vscode.dev/redirect/mcp/install?name=nomnomdrive&config=' +
        encodeURIComponent(vsConfig);
      nomnom.openExternalUrl(link);
      showToast('Opening VS Code installer…');
      return;
    }

    if (client === 'cursor') {
      const cursorConfig = JSON.stringify({ url: activeEndpoint() });
      const b64 = btoa(cursorConfig);
      const link = `cursor://anysphere.cursor-deeplink/mcp/install?name=nomnomdrive&config=${b64}`;
      nomnom.openExternalUrl(link);
      showToast('Opening Cursor installer…');
      return;
    }

    btnStates = { ...btnStates, [client]: 'loading' };
    try {
      const result = await nomnom.registerMcpClient(client, activeEndpoint());
      btnStates = { ...btnStates, [client]: result.registered ? 'installed' : 'not-found' };
      showToast(
        result.registered
          ? `MCP registered for ${result.client}`
          : `${result.client} config dir not detected`,
      );
    } catch (e: any) {
      btnStates = { ...btnStates, [client]: 'error' };
      showToast('Failed: ' + e.message);
    }
    setTimeout(() => {
      btnStates = { ...btnStates, [client]: 'idle' };
    }, 3000);
  }

  function handleCopy(client: string) {
    const cmd = (mcpCommands[client] || '').replace(/\{URL\}/g, activeEndpoint());
    navigator.clipboard.writeText(cmd).then(() => showToast('Copied to clipboard'));
  }

  function copyMcpUrl() {
    navigator.clipboard.writeText(activeEndpoint()).then(() => showToast('MCP URL copied'));
  }

  function installBtnLabel(client: string) {
    const s = btnStates[client] || 'idle';
    if (s === 'loading') return 'Installing…';
    if (s === 'installed') return 'Installed ✓';
    if (s === 'not-found') return 'Not found';
    if (s === 'error') return 'Error';
    return 'Install';
  }

  function installBtnClass(client: string) {
    const s = btnStates[client] || 'idle';
    if (s === 'loading') return 'mcp-install-btn loading';
    if (s === 'installed') return 'mcp-install-btn installed';
    if (s === 'not-found') return 'mcp-install-btn not-found';
    return 'mcp-install-btn';
  }

  // The cloud card sits in the same home pane, collapsed by default — expand it
  // and scroll it into view instead of navigating away.
  function openCloudCard() {
    window.dispatchEvent(new CustomEvent('nomnom:expand-cloud-card'));
    const el = document.getElementById('cloud-card');
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
</script>

<div class="mcp-clients-list">
  <!-- VS Code -->
  <div class="mcp-client-card">
    <div class="mcp-client-info">
      <div class="mcp-client-icon vscode">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M17 2l5 3.5v13L17 22l-10-7.5L3 17.5l-2-1.5V8L3 6.5l4 3L17 2z" fill="#007ACC" />
          <path d="M17 2L7 9.5l-4-3L1 8v8l2 1.5 4-3 10 7.5 5-3.5v-13L17 2zm0 3.5v13L7.5 12 17 5.5z" fill="#1F9CF0" opacity=".8" />
        </svg>
      </div>
      <div class="mcp-client-text">
        <span class="mcp-client-name">VS Code</span>
        <span class="mcp-client-desc">Copilot MCP integration</span>
      </div>
    </div>
    <button class={installBtnClass('vscode')} disabled={btnStates['vscode'] === 'loading'} onclick={() => handleInstall('vscode')}>
      {installBtnLabel('vscode')}
    </button>
  </div>

  <!-- Cursor -->
  <div class="mcp-client-card">
    <div class="mcp-client-info">
      <div class="mcp-client-icon cursor">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="3" fill="#000" />
          <path d="M8 12l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <div class="mcp-client-text">
        <span class="mcp-client-name">Cursor</span>
        <span class="mcp-client-desc">AI code editor MCP</span>
      </div>
    </div>
    <button class={installBtnClass('cursor')} disabled={btnStates['cursor'] === 'loading'} onclick={() => handleInstall('cursor')}>
      {installBtnLabel('cursor')}
    </button>
  </div>

  <!-- Claude Desktop -->
  <div class="mcp-client-card">
    <div class="mcp-client-info">
      <div class="mcp-client-icon claude">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="#D97757" />
          <path d="M8 14c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="9.5" cy="10" r="1" fill="#fff" />
          <circle cx="14.5" cy="10" r="1" fill="#fff" />
        </svg>
      </div>
      <div class="mcp-client-text">
        <span class="mcp-client-name">Claude Desktop</span>
        <span class="mcp-client-desc">Anthropic desktop app</span>
      </div>
    </div>
    <button class={installBtnClass('claude-desktop')} disabled={btnStates['claude-desktop'] === 'loading'} onclick={() => handleInstall('claude-desktop')}>
      {installBtnLabel('claude-desktop')}
    </button>
  </div>

  <div class="mcp-divider"></div>
  <div class="mcp-section-label">Manual setup — copy the snippet into the tool's MCP config</div>

  <!-- Claude Code -->
  <div class="mcp-client-card">
    <div class="mcp-client-info">
      <div class="mcp-client-icon claude-code">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="4" width="20" height="16" rx="2" fill="#1a1a2e" />
          <path d="M6 10l3 3-3 3M12 16h5" stroke="#D97757" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <div class="mcp-client-text">
        <span class="mcp-client-name">Claude Code</span>
        <span class="mcp-client-desc">CLI agent by Anthropic</span>
      </div>
    </div>
    <button class="mcp-copy-btn" onclick={() => handleCopy('claude-code')} title="Copy command">
      <Copy size={12} />
      Copy
    </button>
  </div>

  <!-- OpenCode -->
  <div class="mcp-client-card">
    <div class="mcp-client-info">
      <div class="mcp-client-icon opencode">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="4" width="20" height="16" rx="2" fill="#0f172a" />
          <path d="M7 10l-3 3 3 3M17 10l3 3-3 3M13 8l-2 8" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <div class="mcp-client-text">
        <span class="mcp-client-name">OpenCode</span>
        <span class="mcp-client-desc">Open-source coding CLI</span>
      </div>
    </div>
    <button class="mcp-copy-btn" onclick={() => handleCopy('opencode')} title="Copy command">
      <Copy size={12} />
      Copy
    </button>
  </div>

  <!-- Windsurf -->
  <div class="mcp-client-card">
    <div class="mcp-client-info">
      <div class="mcp-client-icon windsurf">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="#06b6d4" />
          <path d="M7 15c2-4 4-6 5-8 1 2 3 4 5 8" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <div class="mcp-client-text">
        <span class="mcp-client-name">Windsurf</span>
        <span class="mcp-client-desc">Codeium AI editor</span>
      </div>
    </div>
    <button class="mcp-copy-btn" onclick={() => handleCopy('windsurf')} title="Copy command">
      <Copy size={12} />
      Copy
    </button>
  </div>
</div>

<!-- One URL at a time: in cloud mode the endpoint lives in the cloud tunnel card,
     so this box only shows the local endpoint while the tunnel is not set up. -->
{#if !isCloud}
  <div class="mcp-url-box">
    <span class="mcp-url-label">MCP Endpoint</span>
    <div class="mcp-url-value">
      <code>{activeEndpoint()}</code>
      <button class="mcp-url-copy" onclick={copyMcpUrl} title="Copy URL">
        <Copy size={12} />
      </button>
    </div>
  </div>
  <button class="mcp-cloud-promo" onclick={openCloudCard}>
    <Cloud size={13} />
    Connect to cloud to access your data from any device or client
    <span style="margin-left: auto; flex-shrink: 0; display: inline-flex">
      <ChevronRight size={10} />
    </span>
  </button>
{/if}
