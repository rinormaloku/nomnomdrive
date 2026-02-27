# Plan: NomNomDrive Local Standalone (Phase 1)

**TL;DR:** Build a local-only Electron desktop app that watches folders, parses documents (PDF, DOCX, MD, etc.), chunks text, generates embeddings via a local GGUF model (`node-llama-cpp`), and stores everything in libSQL with native vector search. A CLI (`nomnomdrive`) handles setup, search, and folder management. An MCP server runs inside Electron's main process via `@rekog/mcp-nest` on a local HTTP port, so Claude Desktop/Cursor can query indexed documents. A system tray icon shows indexing progress. Everything is offline, no account needed.

**Key architecture decisions:**
- **NestJS is scoped to MCP only** — bootstrapped inside Electron's main process on a local port. Core services (DB, embedder, watcher, parser) are plain TypeScript, injected into NestJS MCP tools.
- **MCP transport: Streamable HTTP** (not stdio) — Electron hosts the MCP server at `http://localhost:<port>/mcp`. Claude Desktop / Cursor connect over HTTP.
- **`nomnomdrive init` auto-registers MCP** — patches Claude Desktop and Cursor config files automatically. User never touches config files.
- **Electron auto-starts at login** — MCP is always available because the app is always running in the background.
- **pnpm monorepo** with `packages/desktop`, `packages/shared` (and later `packages/server` for cloud).

---

## Steps

### 1. Monorepo scaffold

- Initialize pnpm workspace at root with `pnpm-workspace.yaml` listing `packages/*`
- Create `packages/shared/` for types, constants, Zod schemas (MCP tool input schemas, `SyncPayload`, `ChunkRecord`, etc.)
- Create `packages/desktop/` for the Electron app + CLI
- Root `package.json` with workspace scripts: `dev`, `build`, `lint`, `test`
- TypeScript config: root `tsconfig.base.json`, per-package `tsconfig.json` extending it
- ESLint + Prettier config at root

### 2. Electron shell + build config

- `packages/desktop/src/main/index.ts` — Electron `app.whenReady()`, create hidden `BrowserWindow`, set up `Tray`
- `packages/desktop/src/renderer/index.html` — tray popup UI (Dropbox-style: currently indexing file, progress, recent files, animation slot for the SVG bot)
- `packages/desktop/src/renderer/app.ts` — listens to IPC events from main process, updates UI
- `packages/desktop/src/preload.ts` — Electron `contextBridge` exposing IPC channels
- `packages/desktop/electron-builder.config.ts` — build targets (AppImage for Linux, DMG for macOS, NSIS for Windows), native module rebuild config for `node-llama-cpp`
- Auto-start at login via `app.setLoginItemSettings({ openAtLogin: true })`

### 3. Configuration system

- `packages/desktop/src/main/config.ts` — reads/writes `~/.config/nomnomdrive/config.yaml`
- Default config: `mode: local`, `watch.paths: [~/Documents/NomNomDrive]`, `model.local_embed: "hf:ggml-org/embeddinggemma-300M-Q8_0-GGUF"`, `mcp.port: 23847`
- `packages/desktop/config.default.yaml` — template written on `init`
- Use the `yaml` npm package for parsing/serialization

### 4. GGUF model management

- `packages/desktop/src/main/models.ts` — download GGUF model from HuggingFace on `init`, cache to `~/.local/share/nomnomdrive/models/`
- Show CLI progress bar during download (~300MB for `embeddinggemma-300M-Q8_0`)
- On startup, verify model exists and matches config. If mismatch, prompt user for re-index

### 5. Embedding pipeline

- `packages/desktop/src/main/embedder.ts` — wraps `node-llama-cpp`
- On init: call `getLlama()`, `llama.loadModel({ modelPath })`, `model.createEmbeddingContext()`
- Expose `getEmbedding(text: string): Promise<number[]>` and `getEmbeddings(texts: string[]): Promise<number[][]>` (sequential, `context.getEmbeddingFor()` per chunk)
- Keep the model loaded in memory for the lifetime of the Electron process
- Graceful shutdown: dispose context and model on app quit

### 6. Document parsers

- `packages/desktop/src/main/parser.ts` — dispatcher: routes by file extension to the appropriate parser
- `packages/desktop/src/main/parsers/text.ts` — `.md`, `.txt`, `.csv` (built-in `fs.readFile`, strip markdown syntax for `.md`)
- `packages/desktop/src/main/parsers/pdf.ts` — `pdf-parse`
- `packages/desktop/src/main/parsers/docx.ts` — `mammoth`
- `packages/desktop/src/main/parsers/doc.ts` — `word-extractor`
- `packages/desktop/src/main/parsers/office.ts` — `officeparser` for `.odt`, `.rtf`, `.pptx`
- All parsers are async, return plain `string`. Unsupported extensions logged and skipped.

### 7. Text chunker

- `packages/desktop/src/main/chunker.ts` — recursive character splitter (~50 lines)
- Target ~500 tokens per chunk, markdown-aware (split on headings, paragraphs, then sentences)
- Configurable `chunkSize` and `chunkOverlap` (e.g., 100-token overlap for context continuity)

### 8. Local database (libSQL)

- `packages/desktop/src/main/store.ts` — wraps `@libsql/client` with `createClient({ url: "file:~/.local/share/nomnomdrive/local.db" })`
- Schema initialization: `meta`, `folders`, `documents`, `chunks` tables as specified in the PRD
- Vector index: `CREATE INDEX chunks_vec_idx ON chunks(libsql_vector_idx(embedding))`
- Key operations:
  - `upsertDocument(doc)` — insert/replace document + chunks + embeddings in a batch
  - `removeDocument(docId)` — delete document and its chunks
  - `searchSimilar(queryVector, limit, filters)` — `vector_top_k('chunks_vec_idx', queryVector, limit)` joined with `documents`
  - `listFolders()` — folders with document/chunk counts
  - `getDocumentText(filename)` — all chunks concatenated for a document
  - `getMeta(key)` / `setMeta(key, value)` — for `embed_model`, `embed_dims`

### 9. Folder watcher

- `packages/desktop/src/main/watcher.ts` — `chokidar` + `fast-glob` + `picomatch`
- Watch all paths from config, detect add/change/unlink events
- Filter by supported extensions using glob pattern from config
- Debounce rapid changes (e.g., 500ms) to avoid re-indexing during saves
- Emit events to the indexing pipeline

### 10. Indexing pipeline (orchestrator)

- `packages/desktop/src/main/indexer.ts` — coordinates watcher → parser → chunker → embedder → store
- Sequential queue: process one file at a time to avoid overloading the embedding model
- On file add/change: parse → chunk → embed → store (batch transaction)
- On file delete: remove document and chunks from DB
- Content hash (SHA-256) check: skip re-indexing if file content hasn't changed
- Emit progress events via Electron IPC for tray UI updates (current file, chunks done/total, queue length)
- Initial scan on startup: index all files in watched folders that aren't in DB or have changed

### 11. IPC server (daemon ↔ CLI bridge)

- `packages/desktop/src/main/ipc-server.ts` — Unix socket at `~/.local/share/nomnomdrive/daemon.sock`
- JSON-RPC style protocol over the socket
- Commands: `status` (return daemon state, queue, stats), `watch.add`, `watch.remove`, `watch.list`, `reindex`
- Electron IPC (main ↔ renderer): channels for `indexing:progress`, `indexing:complete`, `indexing:error`, `status:update`

### 12. MCP server (inside Electron, `@rekog/mcp-nest`)

- `packages/desktop/src/main/mcp/mcp.module.ts` — NestJS module:
  ```typescript
  McpModule.forRoot({
    name: 'nomnomdrive',
    version: '1.0.0',
    transport: McpTransportType.STREAMABLE_HTTP,
  })
  ```
- `packages/desktop/src/main/mcp/tools/search.tool.ts` — `@Tool` decorator: `search_documents` — takes query, limit, folder, file_type; embeds query with local model then calls `store.searchSimilar()`
- `packages/desktop/src/main/mcp/tools/folders.tool.ts` — `@Tool` decorator: `list_folders` — calls `store.listFolders()`
- `packages/desktop/src/main/mcp/tools/document.tool.ts` — `@Tool` decorator: `get_document` — calls `store.getDocumentText(filename)`
- Bootstrap NestJS inside Electron's main process: `NestFactory.create(McpAppModule)` → `app.listen(MCP_PORT)` on `localhost` only
- MCP port stored in config (default: `23847`) and printed during `nomnomdrive init`

### 13. Auto-registration of MCP clients

- `packages/desktop/src/main/mcp-register.ts` — auto-detect and patch MCP client configs on `init`:
  - **Claude Desktop:** `~/.config/Claude/claude_desktop_config.json` (Linux), `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%/Claude/claude_desktop_config.json` (Windows) — add entry under `mcpServers`
  - **Cursor:** `.cursor/mcp.json` in home dir — add entry under `mcpServers`
  - Entry format: `{ "nomnomdrive": { "url": "http://localhost:23847/mcp" } }`
- Detect which clients are installed before patching (check if config dir exists)
- Backup existing config before modifying
- Print summary: "✔ MCP server registered with Claude Desktop" / "✔ MCP server registered with Cursor" / "⊘ Cursor not detected, skipping"

### 14. CLI (`nomnomdrive`)

- `packages/desktop/src/cli/index.ts` — `commander` root program with subcommands
- `packages/desktop/src/cli/ipc-client.ts` — Unix socket client to communicate with Electron daemon
- Commands:
  - `init.ts` — interactive wizard (`@inquirer/prompts`): create `~/Documents/NomNomDrive/`, download model, init DB, write config, auto-register MCP with detected clients, enable auto-start at login, print summary
  - `watch.ts` — `add <path>`, `remove <path>`, `list` (via IPC to daemon)
  - `search.ts` — `nomnomdrive search "query"` — reads `local.db` directly (no daemon needed), embeds query with `node-llama-cpp`, runs `vector_top_k`, prints top-k results with scores and chunk excerpts
  - `status.ts` — query daemon via IPC socket for PID, queue, indexed count, model info, mode
  - `start.ts` — launch Electron app (spawn detached process)
  - `stop.ts` — send shutdown signal via IPC socket

### 15. System tray + popup UI

- Tray icon: static icon showing NomNomDrive logo; animated when indexing
- On click: show/hide the popup `BrowserWindow` (positioned near tray, like Dropbox)
- Popup content:
  - Currently indexing file name + progress (chunk X/Y)
  - Queue: N files pending
  - Last 5 processed files with timestamps
  - Placeholder for SVG animation (bot eating documents — to be supplied later)
- Menu items: "Show Status", "Open Drop Folder", "Quit"

### 16. Shared package

- `packages/shared/src/types.ts` — `ChunkRecord`, `DocumentRecord`, `FolderRecord`, `SearchResult`, `IndexingProgress`, `DaemonStatus`
- `packages/shared/src/mcp-schemas.ts` — Zod schemas for MCP tool inputs (`SearchDocumentsInput`, `ListFoldersInput`, `GetDocumentInput`)
- `packages/shared/src/constants.ts` — default model name, default port, default embed dims (768), config paths, supported extensions

---

## Verification

1. **Init flow:** Run `nomnomdrive init` → verify model downloads, `~/Documents/NomNomDrive/` created, `local.db` initialized, config written, MCP auto-registered with Claude Desktop/Cursor, auto-start enabled
2. **Indexing:** Drop a `.pdf`, `.md`, `.docx` into the drop folder → verify tray shows progress → verify chunks appear in `local.db` with embeddings
3. **Search:** `nomnomdrive search "query text"` → verify results returned with similarity scores and chunk excerpts
4. **MCP:** Open Claude Desktop (MCP should already be registered) → call `search_documents` tool → verify results
5. **Watch management:** `nomnomdrive watch add ~/some/folder` → verify new folder starts being indexed
6. **Status:** `nomnomdrive status` → verify daemon info, indexed counts, queue
7. **Re-indexing:** Change a watched file → verify content hash triggers re-index, old chunks replaced
8. **Delete:** Remove a file from watched folder → verify document and chunks removed from DB
9. **Auto-start:** Reboot → verify Electron starts in tray → verify MCP responds at `http://localhost:23847/mcp`

---

## Decisions

- **NestJS scoped to MCP only:** core services are plain TypeScript, injected into NestJS MCP tools. Avoids NestJS overhead for watcher/parser/embedder.
- **MCP runs inside Electron (HTTP/SSE)** instead of separate stdio process. Simpler architecture, direct access to services, one process.
- **Auto-registration on init:** detect + patch Claude Desktop, Cursor, and potentially other MCP client configs. User never manually edits config files.
- **Auto-start at login:** via Electron's `app.setLoginItemSettings({ openAtLogin: true })`. MCP is always available.
- **pnpm monorepo** over Bun workspaces — better Electron compatibility.
- **`@rekog/mcp-nest` with Streamable HTTP transport** on localhost — Claude/Cursor connect via `http://localhost:PORT/mcp`.
- **Sequential embedding queue** (one chunk at a time) — avoids memory spikes on the local GGUF model.
- **`nomnomdrive search` reads DB directly** (no daemon required) — but needs to load the embedding model to embed the query, which adds startup latency (~2-3s). Acceptable for CLI search.
- **Init is the only manual step** — after that, drop files and use MCP. Zero friction.
