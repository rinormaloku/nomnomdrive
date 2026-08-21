# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Does

NomNomDrive watches local folders, chunks and embeds documents using a local GGUF model (node-llama-cpp), stores vectors in SQLite + sqlite-vec alongside an FTS5 keyword index, and exposes 3 MCP tools (`search_documents`, `list_files`, `read_document`) over HTTP. The cloud package is a pure WebSocket tunnel relay — it authenticates MCP clients via OAuth 2.1 / API key and forwards tool calls to the user's running local agent. No documents are stored in the cloud.

```
[Any MCP client] → HTTPS + JWT/API key → [cloud: NestJS] → WebSocket → [desktop/CLI: Electron/Node] → local SQLite
```

## Monorepo Structure

pnpm workspaces with three packages:

- **`packages/shared`** — TypeScript library: `AppConfig`/`CloudConfig`, tunnel protocol types, MCP schemas (`SearchDocumentsSchema`, `ListFilesSchema`, `ReadDocumentSchema`), retrieval tuning constants, setup/model utilities. Always build this first.
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

**MCP surface (3 tools, 5 params):** `search_documents(query, filter?)`, `list_files(filter?)`, `read_document(file, from?, to?)`. Design rules, all deliberate:
- **Markdown out, never JSON.** Output is read by a model; prose costs fewer tokens than escaped JSON, and every response ends with the exact next call to make.
- **Names, not paths.** Callers address documents by bare file name. A full path appears only to disambiguate when one name matches several files.
- **One `filter` concept everywhere.** Plain text = substring, regex when metacharacters are present, matched against `FolderName/relative/path` — which is why there is no separate `folder` or `file_type` param. Compiled in `doc-filter.ts`, which refuses nested quantifiers (the pattern reaches the Electron main process from any connected MCP client).
- **Truncate loudly, and only at the source.** Any capped result says how much was dropped and how to get the rest. The tools bound their own output (`SEARCH_MAX_PASSAGES`, `SEARCH_MAX_PASSAGE_CHUNKS`, `READ_MAX_CHUNKS`), so nothing downstream may cut it again — `chat-engine.ts` passes results through verbatim to both the model and the UI, and `ChatTab.svelte` renders every part (header, passages, footer). A blind character cap slices mid-passage and drops the trailing "call this next" instruction. Lower the constants if output needs to shrink.
- **Clamp, don't error.** An out-of-range chunk range returns content, not a validation failure.

**Retrieval (`store.searchHybrid`):** dense vectors fused with FTS5 keyword hits via Reciprocal Rank Fusion, which needs only rank order so cosine and BM25 never have to be calibrated against each other. Chunk text is embedded verbatim — an earlier version prepended a `<metadata>` header (file, name, position) to every chunk, which made file names searchable but flattened the vector space, since the header was near-identical across the corpus. The FTS `filename` column replaced it. Chunks are 500 chars; `handlers.ts` merges adjacent hits into passages and pads them by ±1 chunk, bounded by `SEARCH_MAX_PASSAGE_CHUNKS` so a run of matching chunks cannot flood the response.

**Index schema version:** `INDEX_SCHEMA_VERSION` in `store.ts` guards content-level changes (chunking, embedded text). Bump it whenever new chunks would be incomparable with old ones — the store drops the index and the startup scan rebuilds it. `resetForNewDims` handles the separate case of embedding dimensions changing.

**Chunk IDs:** `makeChunkId(docId, chunkIndex, text)`. `chunks.chunk_id` is UNIQUE and chunk text is no longer salted with per-file metadata, so hashing text alone would collide on repeated boilerplate and abort the whole document's insert.

**Hardware-tiered model recommendations (`hardware-tiers.ts`):** The embedder and chat engine both stay resident — neither unloads when idle — so every budget is for the *pair*. `recommendForHardware()` takes 70% of detected VRAM (`USABLE_MEMORY_FRACTION`; the rest belongs to the user's actual desktop) and walks `HARDWARE_TIERS` strongest-first. A tier is only chosen if the budget clears both its declared `minBudgetGb` **and** the pairing's real cost — so changing a quant in `model-catalog.ts` can never silently start recommending something that doesn't fit. `RERANKER_RESERVE_GB` is held back on every tier that runs a local chat model, keeping room for a reranker without forcing users back through model selection.

`ModelOption.runtimeGb` is the number that drives all of this: GGUF blob size plus a working set, taken from the real file sizes on HuggingFace rather than parameter counts. Gemma 4's E-variants make the difference concrete — "E2B" ships a 2.5 GB Q3_K_M file because per-layer embeddings travel with the weights. Embedding is capped at 4B by design; headroom above that goes to the reranker, which buys more retrieval quality per GB.

**Hardware detection (`hardware-detect.ts`):** Cannot use node-llama-cpp's `getVramState()` for the case that matters — the packaged app ships CPU-only binaries, so it reports 0 until a GPU binary is downloaded, which happens *after* model selection. So it probes the platform directly (nvidia-smi → macOS unified → Windows driver registry → Linux drm sysfs) and only prefers node-llama-cpp when a GPU binary already exists. Windows reads `HardwareInformation.qwMemorySize` from the registry because `Win32_VideoController.AdapterRAM` is 32-bit and saturates at 4 GB. Every probe is time-boxed and best-effort; an unreadable machine reports 0 VRAM and lands on the API-only recommendation. Cached per process, invalidated by `resetHardwareCache()` after a GPU install/remove.

**Cloud credentials:** Stored at `~/.config/nomnomdrive/cloud-credentials.json` (not in `config.yaml`). Loaded by `loadCloudCredentials()` from `@nomnomdrive/shared`.

**Cloud Docker:** `docker compose up` starts cloud + PostgreSQL 16. Required env vars: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `SERVER_URL`.

## MCP-Nest Library

Package: `@rekog/mcp-nest`. Tool method signature: `async toolMethod(args, context, request)` — `request.user.sub` = userId. `McpModule.forRoot({ guards: [CompositeAuthGuard] })` protects all MCP endpoints.
