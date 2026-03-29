# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Does

NomNomDrive watches local folders, chunks and embeds documents using a local GGUF model (node-llama-cpp), stores vectors in SQLite + sqlite-vec, and exposes 3 MCP tools (`search_documents`, `list_folders`, `get_document`) over HTTP. The cloud package is a pure WebSocket tunnel relay — it authenticates MCP clients via OAuth 2.1 / API key and forwards tool calls to the user's running local agent. No documents are stored in the cloud.

```
[Any MCP client] → HTTPS + JWT/API key → [cloud: NestJS] → WebSocket → [desktop/CLI: Electron/Node] → local SQLite
```

## Monorepo Structure

pnpm workspaces with three packages:

- **`packages/shared`** — TypeScript library: `AppConfig`/`CloudConfig`, tunnel protocol types, MCP schemas (`SearchDocumentsSchema`, `GetDocumentSchema`), setup/model utilities. Always build this first.
- **`packages/desktop`** — Electron app + CLI. Main process: `Store` (SQLite), `Embedder` (node-llama-cpp), `Watcher`/`Indexer`, stateless MCP HTTP server on `127.0.0.1:23847`, `TunnelClient` (WebSocket to cloud). Renderer: Svelte 5 SPA. CLI: Commander.js commands including `cloud login/status/logout`.
- **`packages/cloud`** — NestJS app: `CompositeAuthGuard` (JWT or API key), `TunnelGateway` (WebSocket at `/tunnel`), `TunnelService` (registry `Map<userId, socket>`), `ProxyToolsService` (3 `@Tool` methods that call `tunnelService.forwardToolCall(userId, ...)`), TypeORM entities for User and ApiKey, PostgreSQL.

## Commands

```bash
# Development
pnpm dev:desktop          # builds shared, then runs Vite + tsc --watch + Electron concurrently
pnpm dev:cloud            # builds shared, then runs NestJS in watch mode

# Build
pnpm build                # builds shared → desktop → cloud
pnpm build:cloud          # builds shared → cloud only

# CLI (after building desktop)
pnpm nomnomdrive <cmd>    # e.g. pnpm nomnomdrive cloud login

# Type checking
pnpm typecheck            # runs tsc --noEmit + svelte-check across all packages

# Lint
pnpm lint                 # eslint on all packages/*/src

# Package desktop for distribution
cd packages/desktop && pnpm dist
```

## Code Style

Prettier enforced: semi, singleQuote, trailingComma `all`, printWidth 100, tabWidth 2. Config in `.prettierrc`.

## Native Modules

`better-sqlite3` and `sqlite-vec` are native C++ addons rebuilt for the Electron ABI via `postinstall` (`electron-builder install-app-deps`). If you switch Node or Electron versions, run `pnpm rebuild` in the desktop package. The `predist` script replaces pnpm workspace symlinks with file copies before `electron-builder` runs — do not skip it.

## Cloud Local Dev

`pnpm dev:cloud` reads `.env` from the repo root via `dotenv-cli`. Required vars: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `SERVER_URL`. See `docker-compose.yml` for the default PostgreSQL connection string.

## Build Order

Shared must build before desktop or cloud — every `dev:*` and `build` script handles this automatically, but if you run package-level commands directly (e.g., `cd packages/desktop && pnpm build`), build shared first or you'll get stale types.

## Testing

No test framework is set up yet. There are no tests across any package.

## Key Architecture Points

**IPC (Electron main ↔ renderer):** All renderer→main calls go through `preload.ts` (contextBridge) → `nomnom.ts` wrapper in the renderer. Push events from main use `mainWindow.webContents.send(channel)` and `ipcRenderer.on(channel, cb)`. `onCloudStatusChanged` is the pattern for reactive cloud state — the main process emits `cloud:status-changed` after every login/logout; `App.svelte` subscribes and refreshes the `cloudStatus` Svelte store.

**Shared reactive store:** `cloudStatus` (writable) in `stores.ts` is initialised and owned by `App.svelte`; all components (`CloudTab`, `McpTab`, `StatusBar`) read `$cloudStatus` reactively. Never fetch cloud status independently in a component — always read the store.

**Stateless local MCP:** Each POST to `/mcp` creates a fresh `McpServer` + `StreamableHTTPServerTransport`. No session state.

**Tunnel routing:** `TunnelService.agents` is `Map<userId, AgentConnection>`. The `userId` comes from `request.user.sub` (JWT subject). `ProxyToolsService` passes this to `forwardToolCall(userId, toolName, args)` — one WebSocket per user, enforced on reconnect.

**Tool handlers:** Pure async functions in `handlers.ts` are shared by both the local MCP tools (`search.tool.ts`, etc.) and the `TunnelClient` (which receives `tool_call` messages and dispatches to the same handlers).

**Cloud credentials:** Stored at `~/.config/nomnomdrive/cloud-credentials.json` (not in `config.yaml`). Loaded by `loadCloudCredentials()` from `@nomnomdrive/shared`.

**Cloud Docker:** `docker compose up` starts cloud + PostgreSQL 16. Required env vars: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `SERVER_URL`.

## MCP-Nest Library

Package: `@rekog/mcp-nest`. Tool method signature: `async toolMethod(args, context, request)` — `request.user.sub` = userId. `McpModule.forRoot({ guards: [CompositeAuthGuard] })` protects all MCP endpoints.
