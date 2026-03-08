# NomNomDrive Cloud — Phase 1: Tunnel Relay

## Context

NomNomDrive currently runs entirely locally: Electron app watches folders, embeds documents with a local GGUF model, stores vectors in SQLite + sqlite-vec, and exposes 3 MCP tools (`search_documents`, `list_folders`, `get_document`) via a stateless HTTP server on `127.0.0.1:23847/mcp`.

**Goal:** Let users access their local NomNomDrive agent from anywhere (Claude Web, ChatGPT, etc.) via an authenticated cloud MCP endpoint that tunnels requests to their running desktop agent.

**Stack:** NestJS + MCP-Nest (for OAuth 2.1 MCP auth + JWT guards), WebSocket tunnel, PostgreSQL.

---

## Architecture

```
[Claude Web / ChatGPT / any MCP client]
    → HTTPS + Bearer JWT (OAuth 2.1 or API key)
    → [Cloud: NestJS + MCP-Nest]
        → WebSocket tunnel (wss://)
        → [Local NomNomDrive desktop agent]
        → processes search/list/get against local SQLite
    ← relayed response
```

The cloud is a **stateless relay** — it authenticates MCP clients, then forwards tool calls through a persistent WebSocket to the user's local agent. No documents or embeddings are stored in the cloud in Phase 1.

---

## Implementation Steps

### Step 1: Tunnel Protocol Types (`packages/shared`)

Add `packages/shared/src/tunnel-protocol.ts` with:

```typescript
// Cloud → Agent
interface TunnelToolCall { type: 'tool_call'; requestId: string; toolName: string; args: unknown }
interface TunnelPing { type: 'ping' }
type TunnelRequest = TunnelPing | TunnelToolCall;

// Agent → Cloud
interface TunnelToolResponse { type: 'tool_response'; requestId: string; mcpResult?: MCP content; error?: string }
interface TunnelPong { type: 'pong' }
type TunnelResponse = TunnelPong | TunnelToolResponse;
```

Export from `packages/shared/src/index.ts`.

### Step 2: Extend Config (`packages/shared/src/config.ts`)

Add `CloudConfig` interface and optional `cloud` field to `AppConfig`:

```typescript
interface CloudConfig { serverUrl: string }
interface AppConfig { ...; cloud?: CloudConfig }
```

Credentials (JWT, API key) stored separately in `~/.config/nomnomdrive/cloud-credentials.json` — not in config.yaml.

Update `loadConfig`/`saveConfig`/`getDefaultConfig` to handle the new field.

### Step 3: Extract Tool Handlers (`packages/desktop`)

Create `packages/desktop/src/main/mcp/tools/handlers.ts` — extract the core logic from the 3 tool files into pure async functions:

- `executeSearchDocuments(store, embedder, args)` — from `search.tool.ts`
- `executeListFolders(store)` — from `folders.tool.ts`
- `executeGetDocument(store, args)` — from `document.tool.ts`

Then update `search.tool.ts`, `folders.tool.ts`, `document.tool.ts` to call these shared handlers. This allows both the local MCP server and the tunnel client to use the same logic without duplication.

### Step 4: Scaffold Cloud Package (`packages/cloud`)

New NestJS app in the monorepo. Module structure:

```
packages/cloud/src/
  main.ts                      # NestJS bootstrap + cookie-parser + WsAdapter
  app.module.ts                # Root: McpAuthModule + McpModule + feature modules
  auth/
    composite-auth.guard.ts    # Accepts OAuth JWT OR API key
    api-key.service.ts         # Generate/validate/revoke API keys (SHA-256 hashed)
    api-key.controller.ts      # REST: POST/GET/DELETE /api/keys (behind JWT only)
  tunnel/
    tunnel.gateway.ts          # @WebSocketGateway({ path: '/tunnel' })
    tunnel.service.ts          # Registry of connected agents (Map<userId, WebSocket>)
  mcp-proxy/
    proxy-tools.service.ts     # 3 @Tool decorators that relay via TunnelService
  users/
    user.entity.ts             # TypeORM: id, googleId, email, displayName
  api-keys/
    api-key.entity.ts          # TypeORM: id, userId, keyHash, keyPrefix, revoked
```

**Key wiring in `app.module.ts`:**
- `McpAuthModule.forRoot()` with Google OAuth provider, TypeORM PostgreSQL store
- `McpModule.forRoot()` with `guards: [CompositeAuthGuard]` — protects all MCP endpoints
- `CompositeAuthGuard` tries API key first (via `X-Api-Key` header), falls back to MCP-Nest JWT guard

### Step 5: Tunnel Gateway + Service (`packages/cloud`)

**TunnelGateway** (`@WebSocketGateway({ path: '/tunnel' })`):
- On connection: authenticate via `?token=<JWT>` or `?api_key=<key>` query param
- Invalid auth → close with code 4001
- Register socket in TunnelService

**TunnelService:**
- `Map<userId, { socket, lastHeartbeat }>` — one connection per user
- `forwardToolCall(userId, toolName, args)` → sends `TunnelToolCall`, returns Promise that resolves when matching `TunnelToolResponse` arrives (30s timeout)
- Heartbeat: sends `ping` every 30s, expects `pong` within 90s, otherwise closes connection
- When tunnel is disconnected: returns error "Local agent is not connected"

### Step 6: MCP Proxy Tools (`packages/cloud`)

`ProxyToolsService` registers 3 `@Tool` decorated methods that mirror the local tools. Each:
1. Extracts `userId` from `request.user.sub` (populated by CompositeAuthGuard)
2. Calls `tunnelService.forwardToolCall(userId, toolName, args)`
3. Returns the MCP result or error

Reuses `SearchDocumentsSchema`, `GetDocumentSchema` from `@nomnomdrive/shared`.

### Step 7: Tunnel Client (`packages/desktop`)

New `packages/desktop/src/main/tunnel-client.ts`:
- WebSocket client connecting to `wss://<cloud>/tunnel?token=<jwt>`
- Receives `tool_call` → dispatches to extracted handler functions (Step 3) → sends `tool_response`
- Responds to `ping` with `pong`
- Reconnects on disconnect with exponential backoff (1s → 2s → 4s → ... → 30s max, with jitter)

Wire into `packages/desktop/src/main/index.ts`: when `config.mode === 'cloud'` and credentials exist, create and connect TunnelClient alongside the existing local MCP server (local server still runs regardless).

### Step 8: Cloud Login CLI Command

New `nomnomdrive cloud login` command:
1. Opens browser to cloud OAuth authorize URL
2. Starts temporary local HTTP server to receive callback
3. Exchanges auth code for JWT + refresh token
4. Saves to `~/.config/nomnomdrive/cloud-credentials.json`
5. Sets `config.mode` to `cloud`

Also add `nomnomdrive cloud status` (connected/disconnected) and `nomnomdrive cloud logout`.

### Step 9: Docker + Deployment

- `packages/cloud/Dockerfile` — multi-stage build (Node 22)
- `docker-compose.yml` — cloud server + PostgreSQL 16
- Environment vars: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `SERVER_URL`
- Single process handles both HTTP (MCP + OAuth + REST) and WebSocket (tunnel)

---

## Critical Files to Modify

| File | Change |
|------|--------|
| `packages/shared/src/config.ts` | Add `CloudConfig`, extend `AppConfig` |
| `packages/shared/src/index.ts` | Export tunnel protocol types |
| `packages/shared/src/mcp-schemas.ts` | Already exports schemas — reused by cloud proxy |
| `packages/desktop/src/main/mcp/tools/search.tool.ts` | Delegate to extracted handler |
| `packages/desktop/src/main/mcp/tools/folders.tool.ts` | Delegate to extracted handler |
| `packages/desktop/src/main/mcp/tools/document.tool.ts` | Delegate to extracted handler |
| `packages/desktop/src/main/index.ts` | Start TunnelClient when mode=cloud |
| `pnpm-workspace.yaml` | Add `packages/cloud` |

## New Files

| File | Purpose |
|------|---------|
| `packages/shared/src/tunnel-protocol.ts` | WebSocket message types |
| `packages/desktop/src/main/mcp/tools/handlers.ts` | Extracted tool handler functions |
| `packages/desktop/src/main/tunnel-client.ts` | WebSocket tunnel client |
| `packages/desktop/src/cli/commands/cloud.ts` | `cloud login/status/logout` commands |
| `packages/cloud/` (entire package) | NestJS cloud server |

---

## Phase 2 Extensibility

This architecture cleanly extends for cloud-hosted data:

1. **Routing layer**: `ProxyToolsService.relayToAgent()` becomes a routing decision — tunnel for local data, direct query for cloud data, or fan-out for hybrid
2. **Cloud embedding**: New module in `packages/cloud` that accepts chunks, embeds via API (OpenAI/Gemini), stores in PostgreSQL + pgvector
3. **Chunker reuse**: The chunker in `packages/desktop/src/main/chunker.ts` can be moved to `packages/shared` for server-side use
4. **No breaking changes**: Phase 1 tunnel continues working; cloud storage is additive

---

## Verification

1. **Unit**: Cloud proxy tools relay correctly when tunnel is connected/disconnected
2. **Integration**: Start local agent → connect tunnel → call MCP tool via cloud endpoint → verify result matches local search
3. **Auth**: Verify OAuth 2.1 flow works with Claude Web's MCP client; verify API key fallback works
4. **Reconnection**: Kill local agent → verify cloud returns "not connected" error → restart agent → verify auto-reconnect and tool calls resume
5. **Docker**: `docker compose up` starts cloud + PostgreSQL, accessible at `http://localhost:3030/mcp`
