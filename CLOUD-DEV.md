# NomNomDrive Cloud — Local Dev Guide

This guide gets you from zero to a running cloud+desktop stack on your machine so you can verify the full flow: **OAuth login → tunnel connect → MCP tool call**.

---

## Prerequisites

- Node 22+ and pnpm (`npm i -g pnpm`)
- Docker + Docker Compose
- A Google Cloud project with OAuth 2.0 credentials (one-time setup below)

---

## 1. One-time: Google OAuth app

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. **Create OAuth 2.0 Client ID** → Application type: **Web application**
3. Add to **Authorized redirect URIs**:
   ```
   http://localhost:3030/auth/callback
   ```
4. Copy the **Client ID** and **Client Secret**

---

## 2. Create `.env`

In the repo root, create `.env` (it's gitignored):

```bash
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
JWT_SECRET=<any-32+-char-random-string>
SERVER_URL=http://localhost:3030
DATABASE_URL=postgres://nomnom:nomnom@localhost:5432/nomnomdrive
```

Generate a JWT secret quickly:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. Start PostgreSQL

```bash
docker compose up postgres -d
```

That's the only Docker service needed for local dev — the cloud server runs directly via Node.

---

## 4. Install dependencies + build shared

```bash
pnpm install
pnpm --filter @nomnomdrive/shared build
```

---

## 5. Start the cloud server

```bash
pnpm dev:cloud
```

The server starts on **http://localhost:3030**. You should see:
```
[Cloud] NomNomDrive cloud server running on http://0.0.0.0:3030
```

It reads `.env` automatically — no extra tooling needed.

---

## 6. Verify the OAuth endpoints

```bash
# OAuth server metadata (should return JSON)
curl http://localhost:3030/.well-known/oauth-authorization-server | jq .

# MCP protected resource metadata
curl http://localhost:3030/.well-known/oauth-protected-resource | jq .
```

---

## 7. Build and run the desktop app (for tunnel testing)

```bash
# Build the desktop CLI
pnpm --filter @nomnomdrive/desktop build:main

# Log in to the local cloud server
node packages/desktop/dist/cli/index.js cloud login --server http://localhost:3030
```

This opens a browser, completes the Google OAuth flow, saves credentials to
`~/.config/nomnomdrive/cloud-credentials.json`, and sets `mode: cloud` in
`~/.config/nomnomdrive/config.yaml`.

Check the status:
```bash
node packages/desktop/dist/cli/index.js cloud status
```

Expected output:
```
Mode:       cloud
Server:     http://localhost:3030
Auth:       credentials saved
Reachable:  yes
```

---

## 8. Start the desktop daemon (connects the tunnel)

```bash
node packages/desktop/dist/cli/index.js start
```

In the cloud server logs you should see:
```
[TunnelService] Agent connected: <your-user-id>
```

---

## 9. Test MCP tool calls

### Option A — mcp-inspector (recommended)

```bash
npx @modelcontextprotocol/inspector http://localhost:3030/mcp
```

It will trigger the OAuth flow in the browser. Once logged in, you can invoke
`search_documents`, `list_folders`, and `get_document` directly in the UI.

### Option B — curl with an API key

First generate an API key (requires a valid JWT from step 7's login):

```bash
ACCESS_TOKEN=$(cat ~/.config/nomnomdrive/cloud-credentials.json | jq -r .accessToken)

curl -X POST http://localhost:3030/api/keys \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "local-test"}' | jq .
```

Save the returned `key` value, then call the MCP endpoint:

```bash
API_KEY=<key-from-above>

curl -X POST http://localhost:3030/mcp \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "id": 1,
    "params": {
      "name": "list_folders",
      "arguments": {}
    }
  }' | jq .
```

If the desktop tunnel is connected and folders are indexed, you get real results.
If the tunnel isn't connected you'll see:
```json
{"content": [{"type": "text", "text": "Local agent is not connected..."}]}
```

---

## 10. Claude Desktop integration (optional)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `~/.config/claude/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "nomnomdrive-cloud": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3030/mcp"]
    }
  }
}
```

Restart Claude Desktop. It triggers OAuth on first connect.

---

## Dev loop

| What changed | What to run |
|---|---|
| Cloud server code | `Ctrl-C` → `pnpm dev:cloud` |
| Shared types | `pnpm --filter @nomnomdrive/shared build` (cloud auto-picks up via ts-node paths) |
| Desktop CLI | `pnpm --filter @nomnomdrive/desktop build:main` |
| Desktop tunnel | Restart with `nomnomdrive stop && nomnomdrive start` |

Add `nodemon` to get automatic cloud-server reload on file save:
```bash
pnpm add -D nodemon --filter @nomnomdrive/cloud
# Then in packages/cloud/package.json scripts:
# "dev": "nodemon --watch src -e ts --exec 'ts-node -r tsconfig-paths/register src/main.ts'"
```

---

## Troubleshooting

**`Cannot find module '@rekog/mcp-nest'`**
→ Run `pnpm install` from the repo root

**`ECONNREFUSED` connecting to postgres**
→ Check `docker compose ps` — postgres container should be `healthy`

**OAuth redirect mismatch**
→ Confirm `http://localhost:3030/auth/callback` is in your Google OAuth app's redirect URIs

**Tunnel not connecting**
→ Check `~/.config/nomnomdrive/cloud-credentials.json` exists and has `accessToken`
→ Check `~/.config/nomnomdrive/config.yaml` has `mode: cloud` and `cloud.server_url: http://localhost:3030`

**`packages/cloud/**` is gitignored**
→ That's intentional for now (cloud is still private). The files exist locally and are tracked only in your working tree.
