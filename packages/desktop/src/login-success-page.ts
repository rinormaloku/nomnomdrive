// OAuth callback page shown in the browser after a successful login.
// Imported by both the CLI (src/cli/commands/cloud.ts) and the
// Electron main process (src/main/index.ts).

export function loginSuccessPage(serverUrl: string): string {
  const mcpUrl = `${serverUrl}/mcp`;
  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NomNomDrive</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      background: #e4e6ea;
      color: #1d1d1f;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter',
                   Roboto, Helvetica, Arial, sans-serif;
    }

    /* ── Logo ── */
    .logo {
      width: 120px;
      height: 120px;
      animation: nom 0.55s ease-in-out infinite alternate;
      transform-origin: center bottom;
      filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.18));
    }

    @keyframes nom {
      0%   { transform: scaleY(1)    scaleX(1); }
      40%  { transform: scaleY(0.88) scaleX(1.07); }
      100% { transform: scaleY(1)    scaleX(1); }
    }

    /* ── Card ── */
    .card {
      background: #fff;
      border: 1px solid #d8dade;
      border-radius: 16px;
      padding: 32px 40px;
      text-align: center;
      box-shadow: 0 2px 16px rgba(0, 0, 0, 0.10);
      max-width: 420px;
      width: 90%;
    }

    .check {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #e6f4ee;
      margin-bottom: 16px;
    }

    h1 {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 6px;
    }

    p {
      font-size: 13px;
      color: #6e6e73;
      line-height: 1.5;
    }

    /* ── MCP config section ── */
    .divider {
      border: none;
      border-top: 1px solid #e8e8ed;
      margin: 20px 0;
    }

    .config-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #aaa;
      margin-bottom: 8px;
    }

    .url-row {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #f5f5f7;
      border: 1px solid #e0e0e5;
      border-radius: 8px;
      padding: 8px 12px;
      text-align: left;
    }

    .url-row code {
      flex: 1;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace;
      font-size: 12px;
      color: #1d1d1f;
      word-break: break-all;
    }

    .copy-btn {
      flex-shrink: 0;
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      color: #aaa;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s, background 0.15s;
    }
    .copy-btn:hover { color: #0061ff; background: #e8f0ff; }
    .copy-btn.copied { color: #00875a; background: #e6f4ee; }

    .hint {
      margin-top: 10px;
      font-size: 12px;
      color: #aaa;
    }

    /* ── Wordmark ── */
    .brand {
      font-size: 12px;
      color: #aaa;
    }
  </style>
</head>
<body>

  <!--
    SVG logo — the outer dark ring is intentionally removed so only the
    face (dark display + blue eyes) renders.
  -->
  <svg class="logo" viewBox="0 0 344 344" xmlns="http://www.w3.org/2000/svg">
    <!-- face / screen shape (cream-white) -->
    <path fill="#fcfcfc" d="m135.9 285.1c-27.9-4.1-54-12.1-77.6-27.2-32.5-20.9-46.7-50.1-40.5-88.6
      10.2-63.4 43.9-109.1 105.1-130 87.4-29.8 177.9 21.8 200 112 3.9 16 6 32.2 3.8 48.5
      -3.4 25.2-18.4 42.7-38.6 56.4-25.8 17.5-54.9 25.9-85.5 29.7-22.1 2.7-44.2 2.3-66.7-0.8z
      m-62.7-162.4c-13.7 14.4-19 32.1-20.3 51.4-1.9 25.8 9 44.3 31.7 56.2 3.5 1.8 7.2 3.5 10.9 4.9
      30.1 11.2 61.5 12.6 93.1 11.2 22.7-0.9 45.1-4.3 66.1-13.7 27.9-12.6 39.4-32.8 36.2-63.2
      -2.9-27.5-15.2-49.1-40.5-61.9-7.2-3.6-15-6.6-22.8-8.4-33.1-7.8-66.4-7.8-99.8-2.5
      -20.4 3.3-39.2 10.3-54.6 26z"/>
    <!-- dark display bezel -->
    <path fill="#010202" d="m73.4 122.4c15.2-15.4 34-22.4 54.4-25.7 33.4-5.3 66.7-5.3 99.8 2.5
      7.8 1.8 15.6 4.8 22.8 8.4 25.3 12.8 37.6 34.4 40.5 61.9 3.2 30.4-8.3 50.6-36.2 63.2
      -21 9.4-43.4 12.8-66.1 13.7-31.6 1.4-63 0-93.1-11.2-3.7-1.4-7.4-3.1-10.9-4.9
      -22.7-11.9-33.6-30.4-31.7-56.2 1.3-19.3 6.6-37 20.5-51.7z
      m22.1 47.7c-1.8 6.3-0.8 10.2 3.3 11.5 5.3 1.6 7.7-1.5 9.7-6 2.2-4.7 6.5-7.1 11.8-7.1
      5.2 0 9.2 2.4 11.8 7 0.5 0.8 0.8 1.8 1.3 2.7 1.7 3.2 4.5 4.5 7.9 3.5 3.6-0.9 5.4-3.6
      4.8-7.1-0.5-3-1.5-6.2-3.2-8.8-11.9-17.6-37-15.6-47.4 4.3z
      m128.9-16.2c-1.5 0.1-3 0-4.5 0.2-10.2 1.2-20.2 9.7-21.9 18.6-0.7 4 0.1 7.5 4.4 8.9
      4.1 1.4 7.1-0.3 8.7-4.4 2.4-5.6 6.7-8.8 12.8-8.7 6 0.1 10.2 3.3 12.5 9 1.6 4.2 4.9 5.5
      8.9 4 3.9-1.4 5.1-4.6 4.2-8.5-0.5-2.1-1.4-4.1-2.5-6-4.9-8.1-12.2-12.4-22.6-13.1z"/>
    <!-- left eye (blue) -->
    <path fill="#4bb3ec" d="m95.6 169.8c10.3-19.6 35.4-21.6 47.3-4 1.7 2.6 2.7 5.8 3.2 8.8
      0.6 3.5-1.2 6.2-4.8 7.1-3.4 1-6.2-0.3-7.9-3.5-0.5-0.9-0.8-1.9-1.3-2.7-2.6-4.6-6.6-7
      -11.8-7-5.3 0-9.6 2.4-11.8 7.1-2 4.5-4.4 7.6-9.7 6-4.1-1.3-5.1-5.2-3.2-11.8z"/>
    <!-- right eye (blue) -->
    <path fill="#4bb3ec" d="m224.9 153.9c9.9 0.7 17.2 5 22.1 13.1 1.1 1.9 2 3.9 2.5 6
      0.9 3.9-0.3 7.1-4.2 8.5-4 1.5-7.3 0.2-8.9-4-2.3-5.7-6.5-8.9-12.5-9-6.1-0.1-10.4 3.1
      -12.8 8.7-1.6 4.1-4.6 5.8-8.7 4.4-4.3-1.4-5.1-4.9-4.4-8.9 1.7-8.9 11.7-17.4 21.9-18.6
      1.5-0.2 3-0.1 5-0.2z"/>
  </svg>

  <div class="card">
    <div class="check">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M5 11.5L9 15.5L17 7.5"
              stroke="#00875a" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>Logged in successfully</h1>
    <p>Add the MCP server below to your AI client to give it access to your files.</p>

    <hr class="divider" />

    <p class="config-label">MCP Server URL</p>
    <div class="url-row">
      <code id="mcp-url">${mcpUrl}</code>
      <button class="copy-btn" id="copy-btn" title="Copy URL" onclick="copyUrl()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.25"/>
          <path d="M3.5 10.5H2.5C1.948 10.5 1.5 10.052 1.5 9.5V2.5C1.5 1.948 1.948 1.5 2.5 1.5H9.5C10.052 1.5 10.5 1.948 10.5 2.5V3.5" stroke="currentColor" stroke-width="1.25"/>
        </svg>
      </button>
    </div>
    <p class="hint">You can close this tab when you're done.</p>
  </div>

  <p class="brand">NomNomDrive</p>

  <script>
    function copyUrl() {
      const url = document.getElementById('mcp-url').textContent;
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('copy-btn');
        btn.classList.add('copied');
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8L6.5 11.5L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = \'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.25"/><path d="M3.5 10.5H2.5C1.948 10.5 1.5 10.052 1.5 9.5V2.5C1.5 1.948 1.948 1.5 2.5 1.5H9.5C10.052 1.5 10.5 1.948 10.5 2.5V3.5" stroke="currentColor" stroke-width="1.25"/></svg>\';
        }, 2000);
      });
    }
  </script>

</body>
</html>
`.trim();
}
