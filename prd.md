# Implementation Plan: Document Sync → MCP Server Product

## Product Summary

An **Electron desktop app + CLI** that watches local folders, parses documents, generates embeddings using a local GGUF model, and stores everything in libSQL. Documents are searchable and chattable via a **CLI** and exposed to AI agents via a local **MCP server** (stdio). A system tray icon (like Dropbox) shows live indexing progress.

**Currently supported: Local mode only.** Local mode is fully standalone — no account, no internet connection, no cloud dependency of any kind. Users install the app, run `nomnomdrive init` in the terminal, and are working in under a minute.

**Cloud mode** (future) adds sync to a Hetzner server for always-on remote MCP access, higher-quality embeddings via batched API, and OCR for scanned documents.

The cloud server is a **Bun/Hono** app on Hetzner — Electron is only for the desktop client.

---

## Architecture Overview

### Local Mode (Current — Standalone, No Cloud)

```
┌───────────────────────────────────────────────────────────────┐
│              Desktop App (Electron + Node.js)                  │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Default drop folder: ~/Documents/NomNomDrive/           │ │
│  │  + user-configured paths (added via CLI)                 │ │
│  └─────────────────────────┬────────────────────────────────┘ │
│                             │ chokidar file events             │
│  ┌──────────┐  ┌────────────▼───┐  ┌───────────────────────┐ │
│  │  Folder   │  │  Document      │→ │  node-llama-cpp        │ │
│  │  Watcher  │  │  Parser        │  │  (GGUF embeddings)    │ │
│  │ (chokidar)│  │ (multi-lib)    │  │  embeddinggemma-300M  │ │
│  └──────────┘  └────────────────┘  └───────────┬───────────┘ │
│                                                 │             │
│                                       ┌─────────▼──────────┐ │
│                                       │  libSQL (local.db)  │ │
│                                       │  + vector search    │ │
│                                       └──────┬──────┬───────┘ │
│                                              │      │         │
│                              ┌───────────────┘      │         │
│                              │                       │         │
│  ┌───────────────────┐  ┌────▼──────────┐           │         │
│  │  System Tray      │  │  MCP Server   │           │         │
│  │  (click → window) │  │  (stdio)      │           │         │
│  │  - indexing state │  │  Claude/Cursor│           │         │
│  │  - recent files   │  │  connect here │           │         │
│  │  - queue progress │  └───────────────┘           │         │
│  └───────────────────┘                              │         │
│                                                     │         │
│  ┌──────────────────────────────────────────────────▼───────┐ │
│  │  CLI  (nomnomdrive)                                       │ │
│  │  init · watch · search · chat                            │ │
│  │  (reads local.db directly for search/chat)               │ │
│  └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘

No network required. No account. Fully self-contained.
```

### Cloud Mode (Future)

```
Desktop App (local mode, as above)
         │
         │  HTTPS — text chunks only (no vectors)
         ▼
┌─────────────────────────────────────────────────┐
│          Hetzner VPS (~€4/mo)                    │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Hono Server (Bun)                        │   │
│  │                                           │   │
│  │  ┌─────────────┐  ┌───────────────────┐  │   │
│  │  │ WebSocket   │  │ Branded MCP       │  │   │
│  │  │ Relay Hub   │  │ Endpoint (HTTP)   │  │   │
│  │  └─────────────┘  └───────────────────┘  │   │
│  │                                           │   │
│  │  ┌─────────────┐  ┌───────────────────┐  │   │
│  │  │ Sync API    │  │ SSR Dashboard     │  │   │
│  │  │ (receive    │  │ (Hono JSX)        │  │   │
│  │  │  chunks +   │  │                   │  │   │
│  │  │  re-embed)  │  │                   │  │   │
│  │  └──────┬──────┘  └───────────────────┘  │   │
│  └─────────┼────────────────────────────────┘   │
│            │                                     │
│  ┌─────────┴──────────────────────────────────┐ │
│  │  sqld (libSQL server, Docker)               │ │
│  │  + vector search (native F32_BLOB)          │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## Core Design Decisions

### Split Embedding Strategy: Local vs. Cloud

Local mode and Cloud mode intentionally use **different embedding models**. There is no requirement for them to match.

| | Local Mode | Cloud Mode |
|---|---|---|
| **Model** | GGUF via `node-llama-cpp` (e.g. `embeddinggemma-300M-Q8_0`) | API-based (e.g. Qwen3 Embeddings `https://deepinfra.com/Qwen/Qwen3-Embedding-4B-batch`) |
| **Where it runs** | On the user's machine | On the Hetzner server |
| **Quality** | Good (CPU-optimized, ~300MB) | Excellent (state-of-the-art, large context) |
| **Batching** | Sequential, one chunk at a time | Batch API calls — much cheaper per chunk |
| **OCR** | Not supported | ✅ Scanned PDFs can be OCR'd before embedding |
| **Sync payload** | N/A (stays local) | **Text chunks only** — server does the embedding |

This separation means:
- **The desktop never sends vectors to the cloud.** It sends text. The cloud re-embeds with its own model.
- **Local vector dimensions don't need to match cloud vector dimensions.** They live in separate databases with independent schemas.
- **Cloud mode is a meaningful upgrade:** better retrieval quality, OCR support, always-on, and no GPU/RAM load on the user's machine.

```yaml
# ~/.config/nomnomdrive/config.yaml
mode: local  # 'local' or 'cloud'

watch:
  paths:
    - ~/Documents/NomNomDrive    # default drop folder (created on init)
    - ~/work/company-wiki        # user-added paths
  glob: "**/*"

model:
  # Local GGUF model for on-device embedding
  local_embed: "hf:ggml-org/embeddinggemma-300M-Q8_0-GGUF"  # ~300MB
  # Power users can swap, but it triggers a local full re-index:
  # local_embed: "hf:BAAI/bge-m3-GGUF/bge-m3-Q8_0.gguf"
  # local_embed: "/absolute/path/to/custom-model.gguf"

  # Cloud embedding is configured server-side. Users don't control this.
```

The local model identifier is stored in `meta.embed_model` in `local.db`. On startup, if the configured local model doesn't match what's in the DB, the app prompts: *"Local embedding model changed. This requires re-indexing all documents locally. Continue?"*

**Changing the cloud model** is a server-side operation. The server re-embeds all stored text chunks using the new model. This is invisible to the user and doesn't require any desktop action.

### libSQL Everywhere

One database format, one query language, one client library. No translation layers.

- **Desktop:** `@libsql/client` writing to `file:local.db`
- **Cloud:** `sqld` (libSQL server daemon) running in Docker on Hetzner
- **Vector search:** Native `F32_BLOB` columns with `vector_top_k()` — built into libSQL, no extensions

When the user enables cloud mode, the desktop pushes **text chunks only** to the cloud over HTTPS. The server re-embeds them with its own model and stores the resulting vectors in sqld. The cloud DB is a push target — data flows one direction only (desktop → cloud). No conflict resolution needed. Local and cloud vector schemas are independent and may have different embedding dimensions.

### node-llama-cpp for Local Inference

Single native dependency for the desktop that handles local embeddings via llama.cpp's optimized SIMD kernels (AVX2, AVX512, ARM NEON, Metal). Auto-detects CPU features. GGUF models are memory-efficient and run entirely offline.

The local embedder is used **only for Local mode queries** — searching `local.db` on-device. It is not used for cloud sync. Local embeddings stay on the machine.

For v1, only the local embedding model ships. Reranking and generation models can be added in v2.

### Electron for the Desktop App

Electron is the right tool here because of native C++ module support. `node-llama-cpp` is a heavy native dependency. Electron's packager (`electron-builder`) has native module compilation built-in and produces reliable installers for Mac, Windows, and Linux.

**Why Electron**

1. **Native C++ support is flawless.** `node-llama-cpp` links against llama.cpp's compiled C++ library. `electron-builder` rebuilds native modules for the correct Electron ABI automatically.
2. **First-class system tray API.** Electron's built-in `Tray` module handles the menubar/taskbar icon natively on all platforms with no third-party glue.
3. **Renderer process for UI.** The "bot eating documents" animation and sync status UI can be a lightweight HTML/CSS page running in a hidden Chromium window that only appears when the user clicks the tray icon.

**The Two Electron Processes:**

| Process | Runtime | Responsibility |
|---|---|---|
| **Main Process** | Node.js v22+ | Folder watching, file parsing, embedding, local database, MCP stdio server, IPC events to tray UI. In cloud mode: also handles sync client and WebSocket relay. |
| **Renderer Process** | Chromium (local HTML) | Tray popup window (like Dropbox menu): indexing progress, recently processed files, sync queue. Receives events from main via `ipcRenderer`. |

The cloud server stays on **Bun + Hono** — this change only affects the desktop client.

### CLI-First User Experience

All configuration and interaction happens in the **terminal**. There is no web dashboard or GUI setup wizard. The Electron app runs silently in the background; the tray icon is the only visible presence until clicked.

**Setup (run once after installing):**

```bash
nomnomdrive init
# Interactive prompts:
# ✔ Created default drop folder: ~/Documents/NomNomDrive/
# └ Downloading embedding model (embeddinggemma-300M-Q8_0)... 312MB ░░░░░░░░ 100%
# ✔ Database initialized at ~/.local/share/nomnomdrive/local.db
# ✔ App is watching. Drop any file into ~/Documents/NomNomDrive/ to index it.
#
# To connect Claude Desktop or Cursor, add this to your MCP config:
# { "command": "nomnomdrive", "args": ["mcp"] }
```

**Managing watched folders:**

```bash
nomnomdrive watch list
# ✓ ~/Documents/NomNomDrive/    (default, 142 files, 1,847 chunks)
# ✓ ~/work/company-wiki/         (312 files, 4,201 chunks)

nomnomdrive watch add ~/work/company-wiki
nomnomdrive watch remove ~/work/company-wiki
```

**Searching documents:**

```bash
nomnomdrive search "refund policy for enterprise customers"
# Results (top 5):
# 1. [0.92] contracts/enterprise-tos-2025.pdf  (chunk 14)
#    "...Enterprise refunds are processed within 30 business days..."
# 2. [0.88] wiki/billing-faq.md  (chunk 3)
#    "...customers on annual plans may request a pro-rated refund..."
```

**Chatting with documents (interactive REPL):**

```bash
nomnomdrive chat
# ● NomNomDrive Chat  (4,048 chunks indexed across 2 folders)
# Type your question, or :quit to exit.
#
# You: What is our refund policy for enterprise customers?
# ● Searching... (found 5 relevant chunks)
#
# Based on your documents:
# Enterprise customers on annual plans can request a pro-rated refund
# within 30 days of renewal. Monthly customers receive credit, not cash
# refunds. [Source: contracts/enterprise-tos-2025.pdf, billing-faq.md]
#
# You: _
```

Chat uses local vector search to retrieve relevant chunks, then calls the local GGUF generation model (small, fast) to synthesize an answer. For v1, it can also print raw chunks without generation (simpler, faster).

**Status:**

```bash
nomnomdrive status
# Daemon: ✔ running (PID 12847)
# Indexed: 454 files, 6,048 chunks
# Queue:   3 files pending
# Model:   embeddinggemma-300M-Q8_0 (loaded)
# Mode:    local
```

**Starting/stopping the daemon:**

```bash
nomnomdrive start   # launches Electron app (tray icon appears)
nomnomdrive stop    # terminates daemon
```

The CLI communicates with the running Electron main process via a **local Unix socket** (`~/.local/share/nomnomdrive/daemon.sock`). Commands that don't need the daemon (e.g. `search`, `chat`) query `local.db` directly.

### Hetzner VPS Over PaaS

A single CX22 in Germany (2 vCPU, 4GB RAM, 40GB NVMe, 20TB traffic) for ~€4/mo. Runs the Hono server, sqld, and the embedding model for any server-side needs. Everything on one box. Predictable cost regardless of WebSocket connections or query volume.

---

## Tech Stack

### Desktop App

| Component | Technology | Why |
|---|---|---|
| App shell | **Electron** | Native module support for `node-llama-cpp` (C++ addon). Built-in `Tray` API. `electron-builder` produces signed installers for Win/Mac/Linux automatically. |
| Main process runtime | **Node.js v22+** (inside Electron) | Hosts all backend logic: watching, parsing, embedding, database, MCP stdio server. |
| UI (renderer) | **Chromium window** (hidden by default) | Tray popup (like Dropbox): shows files being indexed, recently processed files, queue. Communicates with main via Electron IPC. |
| Language | **TypeScript** | End-to-end type safety. AI generates excellent TS code. |
| CLI | **`nomnomdrive` binary** (compiled with `pkg` or shipped alongside Electron) | Terminal interface for init, watch management, search, chat, status. Talks to Electron daemon via Unix socket, or queries `local.db` directly. |
| CLI framework | **commander** + **@inquirer/prompts** | `commander` for subcommands/flags; `inquirer` for interactive `init` prompts and `chat` REPL. |
| Folder watching | **chokidar** | Battle-tested cross-platform file watcher. |
| File matching | **fast-glob** + **picomatch** | Fast directory scanning and user-configurable glob patterns. |
| Document parsing | **Per-format libraries** (see table below) | Each parser is best-in-class for its format. No single library handles all formats well at speed. |
| Text chunking | Custom splitter (~50 lines) | Recursive character splitting with markdown awareness. No heavy dependency needed. |
| Embeddings | **node-llama-cpp** | Runs GGUF models locally via llama.cpp. CPU-optimized with automatic SIMD detection. |
| Default model | **embeddinggemma-300M-Q8_0** | ~300MB, fast on CPU (10-50ms per chunk on modern hardware), good quality for retrieval. Auto-downloaded from HuggingFace on `init`. |
| Local database | **@libsql/client** | libSQL (SQLite fork by Turso). Native vector search via `F32_BLOB`. File-based (`local.db`). |
| Local MCP server | **@modelcontextprotocol/sdk** | Official TS SDK. stdio transport — `nomnomdrive mcp` is the entrypoint Claude Desktop / Cursor invoke. |
| Config | **YAML file** | In `~/.config/nomnomdrive/config.yaml`. Watched paths, model path, mode. |
| Packaging | **electron-builder** | Rebuilds native Node addons for the correct Electron ABI. Produces `.dmg`, `.exe`, `.AppImage` installers. |

### Document Parsing Strategy

Each file format uses the fastest, most reliable parser available. `officeparser` was evaluated but is too slow for large documents; the table below reflects per-format best choices.

| Extension | Parser | Notes |
|---|---|---|
| `.md` | Built-in (read + strip) | Strip markdown syntax, preserve text. No dependency. |
| `.txt` | Built-in (`fs.readFile`) | Plain UTF-8 read. No dependency. |
| `.csv` | Built-in (split lines) | Read as text rows. No dependency. Google Sheets export. |
| `.pdf` | **pdf-parse** | Pure JS PDF text extraction. Fast, no native bindings. |
| `.doc` | **word-extractor** | Legacy Word 97-2003 format (`.doc`). Pure JS. |
| `.docx` | **mammoth** | Modern Word 2007+ format. Excellent text fidelity, pure JS. |
| `.odt` | **officeparser** | OpenDocument Text (LibreOffice, Google Docs). Used only for ODT. |
| `.rtf` | **officeparser** | Rich Text Format. Used only for RTF. |
| `.pptx` | **officeparser** | PowerPoint presentations. Used only for PPTX. |

`parser.ts` dispatches to the correct library based on file extension. All parsers are async and return a plain string. Unsupported extensions are skipped with a log warning.

### Cloud Server

| Component | Technology | Why |
|---|---|---|
| Runtime | **Bun** on Hetzner CX22 | Same runtime as desktop. ~€4/mo. |
| Web framework | **Hono** | Ultralight, native Bun support, built-in CORS/auth middleware. Hono JSX for SSR. |
| WebSocket relay | **Bun native WebSocket** | Fastest WS implementation in JS. No extra dependency. |
| Database server | **sqld** (Docker) | libSQL in server mode. Exposes SQLite over HTTP, secured with JWT auth. |
| Auth | **API key + JWT** | API key per user for MCP endpoint. JWT for WebSocket auth and sqld access. |
| Cloud embedding | **Gemini `text-embedding-004`** (or OpenAI `text-embedding-3-large`) | Batched API calls. High-quality vectors, large context. Replaces client-side GGUF embedding for cloud vectors. Server re-embeds text received from desktop. |
| OCR | **Google Document AI** or **Tesseract** (optional) | Server-side OCR on scanned PDFs before embedding. Key cloud-only feature. |
| MCP endpoint | **@modelcontextprotocol/sdk** + **@modelcontextprotocol/hono** | Official SDK with Hono adapter. Streamable HTTP transport. |
| SSR dashboard | **Hono JSX** + **PicoCSS** | Server-rendered HTML. User settings, API keys, sync status. No React, no build step. |
| Hosting | **Hetzner Cloud CX22** | Nuremberg/Falkenstein. Docker Compose for sqld + Bun app. |

---

## Database Schema

### Local Database (`local.db`)

```sql
-- Metadata about the database itself
CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- Stores: local_embed_model (e.g. "embeddinggemma-300M-Q8_0"), local_embed_dims (e.g. "768")

-- Watched folders
CREATE TABLE folders (
    folder_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    glob_pattern TEXT DEFAULT '**/*',
    created_at INTEGER NOT NULL
);

-- Indexed documents (one row per file)
CREATE TABLE documents (
    doc_id TEXT PRIMARY KEY,          -- deterministic: hash(folder_id + relative_path)
    folder_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,        -- SHA-256 of file contents
    file_size INTEGER,
    file_type TEXT,                    -- pdf, docx, md, txt, etc.
    indexed_at INTEGER NOT NULL,
    FOREIGN KEY (folder_id) REFERENCES folders(folder_id)
);

-- Text chunks with embeddings
CREATE TABLE chunks (
    chunk_id TEXT PRIMARY KEY,         -- deterministic: hash(doc_id + chunk_index)
    doc_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding F32_BLOB(768),           -- dims match the configured LOCAL model
    local_version INTEGER NOT NULL DEFAULT 1,
    synced_version INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (doc_id) REFERENCES documents(doc_id)
);

CREATE INDEX chunks_vec_idx ON chunks(libsql_vector_idx(embedding));
CREATE INDEX chunks_doc_idx ON chunks(doc_id);

-- Sync queue (tracks what needs to be pushed to cloud)
CREATE TABLE sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    action TEXT NOT NULL,              -- 'upsert' or 'delete'
    queued_at INTEGER NOT NULL,
    pushed_at INTEGER                  -- NULL until successfully synced
);

CREATE INDEX sync_queue_pending ON sync_queue(pushed_at) WHERE pushed_at IS NULL;
```

### Cloud Database (sqld on Hetzner)

```sql
-- Per-user chunks (multi-tenant via user_id)
-- Embedding dims are determined by the server-side cloud model (independent of local model)
CREATE TABLE chunks (
    chunk_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,             -- text is stored; cloud re-embeds on receipt
    embedding F32_BLOB(768),           -- dims set by current cloud embed model
    filename TEXT,                     -- original relative path for display
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, chunk_id)
);

CREATE INDEX chunks_vec_idx ON chunks(libsql_vector_idx(embedding));
CREATE INDEX chunks_user_doc ON chunks(user_id, doc_id);

-- User accounts
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    api_key TEXT UNIQUE NOT NULL,      -- for MCP endpoint auth
    mode TEXT DEFAULT 'local',         -- 'local' or 'cloud'
    plan TEXT DEFAULT 'free',
    created_at INTEGER NOT NULL
);

-- Server-wide embedding model config (single source of truth for cloud vectors)
CREATE TABLE server_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- Stores: cloud_embed_model, cloud_embed_dims, cloud_embed_provider

-- Connection tracking (for relay "offline" detection)
CREATE TABLE connections (
    user_id TEXT PRIMARY KEY,
    connected_at INTEGER,
    last_seen_at INTEGER,
    is_online INTEGER DEFAULT 0
);
```

---

## The Two Modes

### Mode 1: Local (Standalone — Currently Implemented)

```
User's Machine only — zero network dependency
┌──────────────────────────────────────────────────────────┐
│  ~/Documents/NomNomDrive/  (default drop folder)         │
│  + any additional paths configured via CLI               │
└──────────────────────┬───────────────────────────────────┘
                       │ file change events
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Desktop App (Electron, background)                       │
│  parse → chunk → embed (GGUF) → store in local.db        │
│                                                          │
│  System Tray popup:                                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ● Indexing: quarterly-report-2025.pdf  (12/34 ch.) │  │
│  │ ✓ enterprise-tos.docx        2 min ago             │  │
│  │ ✓ billing-faq.md             5 min ago             │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────┬────────────────────────────┬──────────────┘
               │                            │
        stdio (MCP)                   Unix socket
               │                            │
    ┌──────────▼──────────┐     ┌───────────▼──────────┐
    │  Claude Desktop /   │     │  CLI (nomnomdrive)   │
    │  Cursor / any agent │     │  search, chat,       │
    │  (calls mcp tools)  │     │  watch, status       │
    └─────────────────────┘     └──────────────────────┘
```

The electron app on clicking the tray shows a popup with indexing status: which file is being processed, how many chunks are done, and recent files. This shows an animation of a bot eating documents, I will supply the animation afterwards but just fyi that it has a svg animation.

The CLI can be used for searching and chatting with the indexed documents, as well as managing watched folders.
Chatting should be simple retrieval + generation using the local GGUF model.

**No internet. No account. No setup beyond `nomnomdrive init`.**

**Flow:**
1. User runs `nomnomdrive init` → downloads model, creates `~/Documents/NomNomDrive/`, exposes MCP endpoint using MCP-Nest (context7 has docs how to do that).
2. Electron daemon starts at login, watches all configured paths
3. Drop a file → parsed, chunked, embedded, stored in `local.db` → tray updates
4. Agents call MCP tools (Claude Desktop / Cursor → `nomnomdrive mcp` stdio)
5. `nomnomdrive search` and `nomnomdrive chat` work from any terminal, offline

**Cost to you:** €0. Nothing runs on a server.

### Mode 2: Cloud (Convenience / Always-On)

```
User's Computer                          Hetzner VPS
┌─────────────────┐    HTTPS POST      ┌──────────────────┐
│ Desktop App     │───────────────────►│ Hono Server      │
│                 │  text chunks only  │                  │
│ - Watches dirs  │   (no vectors)     │ - Sync API       │
│ - Parses docs   │                    │   receives text  │
│ - Embeds locally│                    │ - Re-embeds with │
│   (local only)  │                    │   cloud model    │
│ - libSQL local  │                    │   (batched API)  │
│ - Pushes text   │                    │                  │
│   delta to cloud│                    │ - sqld stores    │
└─────────────────┘                    │   cloud vectors  │
                                        │                  │
                                        │ - MCP endpoint   │
                                        │   queries sqld   │◄── Claude, Cursor,
                                        │   directly       │    any agent
                                        └──────────────────┘

App doesn't need to be running for queries. Cloud uses better model + OCR.
```

**Flow:**
1. Desktop parses, chunks, and embeds locally with the GGUF model (local copy stays in `local.db`)
2. Pushes **text chunks + metadata only** (no vectors) to `POST /api/sync`
3. Cloud receives text, runs it through the cloud embedding model in batches, stores resulting vectors in sqld
4. For scanned PDFs or images: cloud also runs OCR before embedding (desktop skips these)
5. MCP endpoint queries sqld, returns results. Desktop can be off.

---

## Offline Sync Protocol

The desktop is always the source of truth. The cloud is a push target.

### How It Works

Every write to the local DB also writes to `sync_queue`. The local indexing pipeline embeds with the GGUF model (stored in `local.db`). When syncing to cloud, **only text chunks are sent** — the cloud re-embeds with its own model:

```typescript
// When a file is created or changed:
async function indexDocument(filePath: string) {
  const content = await parseDocument(filePath);
  const chunks = splitIntoChunks(content);
  const embeddings = await embedChunks(chunks);  // node-llama-cpp (local only)

  const docId = hash(folderId + relativePath);
  const contentHash = sha256(rawFileBytes);

  await db.batch([
    // Upsert document record
    sql`INSERT OR REPLACE INTO documents (doc_id, folder_id, relative_path, content_hash, file_size, file_type, indexed_at)
        VALUES (${docId}, ${folderId}, ${relativePath}, ${contentHash}, ${fileSize}, ${fileType}, unixepoch())`,

    // Delete old chunks for this doc
    sql`DELETE FROM chunks WHERE doc_id = ${docId}`,

    // Insert new chunks with LOCAL embeddings
    ...chunks.map((chunk, i) => {
      const chunkId = hash(docId + i);
      return sql`INSERT INTO chunks (chunk_id, doc_id, chunk_index, content, embedding, local_version)
                  VALUES (${chunkId}, ${docId}, ${i}, ${chunk.text}, vector32(${embeddings[i]}), 1)`;
    }),

    // Queue for cloud sync (text only — cloud will re-embed)
    sql`INSERT INTO sync_queue (doc_id, action, queued_at) VALUES (${docId}, 'upsert', unixepoch())`
  ]);
}

// When a file is deleted:
async function removeDocument(docId: string) {
  await db.batch([
    sql`DELETE FROM chunks WHERE doc_id = ${docId}`,
    sql`DELETE FROM documents WHERE doc_id = ${docId}`,
    sql`INSERT INTO sync_queue (doc_id, action, queued_at) VALUES (${docId}, 'delete', unixepoch())`
  ]);
}
```

### Sync on Reconnect

When the app comes online (startup, network restored, user enables cloud mode):

```typescript
async function syncToCloud() {
  // 1. Get all pending sync items
  const pending = await local.execute(
    `SELECT id, doc_id, action FROM sync_queue WHERE pushed_at IS NULL ORDER BY queued_at ASC`
  );

  // 2. Deduplicate: if same doc has multiple entries, only latest matters
  const latestByDoc = deduplicateByDocId(pending.rows);

  // 3. For upserts: gather TEXT CHUNKS only (no embeddings — cloud re-embeds)
  const upserts = latestByDoc.filter(r => r.action === 'upsert');
  for (const batch of batchesOf(upserts, 100)) {
    const docIds = batch.map(r => r.doc_id);
    const chunks = await local.execute(`
      SELECT c.chunk_id, c.doc_id, c.chunk_index, c.content,
             d.relative_path as filename
      FROM chunks c
      JOIN documents d ON c.doc_id = d.doc_id
      WHERE c.doc_id IN (${placeholders(docIds)})
    `, docIds);

    // Push text to cloud — NO vectors. Cloud will re-embed with its own model.
    await fetch('https://api.yourbrand.com/api/sync', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Encoding': 'gzip'
      },
      body: gzip(JSON.stringify({ upserts: chunks.rows, deletes: [] }))
    });

    // Mark as synced
    await local.execute(
      `UPDATE sync_queue SET pushed_at = unixepoch() WHERE doc_id IN (${placeholders(docIds)})`,
      docIds
    );
  }

  // 4. For deletes: just send doc_ids
  const deletes = latestByDoc.filter(r => r.action === 'delete');
  if (deletes.length > 0) {
    await fetch('https://api.yourbrand.com/api/sync', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ upserts: [], deletes: deletes.map(r => r.doc_id) })
    });
  }

  // 5. Prune old queue entries
  await local.execute(
    `DELETE FROM sync_queue WHERE pushed_at IS NOT NULL AND pushed_at < unixepoch() - 604800`
  );
}
```

### Initial Sync (First Time Enabling Cloud)

When a user flips from local → cloud with an existing library:

1. Every document gets an entry in `sync_queue` with `action = 'upsert'`
2. Normal `syncToCloud()` runs, batching everything
3. UI shows progress: "Syncing to cloud... 450/2,000 chunks"
4. The cloud receives text and kicks off batch embedding with the cloud model. This is async — the server queues embedding jobs and updates sqld as each batch completes.
5. Large libraries may take a few minutes for cloud embeddings to finish, but MCP queries start returning results as soon as any batch is embedded.

### Local Embedding Model Change

When the user changes the **local** model in config:

1. App detects mismatch: configured model ≠ `meta.embed_model` in `local.db`
2. Warns: *"Local embedding model changed. This requires re-indexing all N documents locally (~X minutes). Continue?"*
3. If yes:
   - Updates `meta.embed_model` and `meta.embed_dims` in `local.db`
   - Drops and recreates local vector index
   - Re-reads every file, re-chunks, re-embeds with new local model
   - If cloud mode is enabled: marks every doc for re-sync (text re-upload triggers new cloud re-embedding)
4. If no: reverts config to current model

**Changing the cloud embedding model** is a server-side migration. The server iterates over all stored text chunks and re-embeds with the new model, then updates the vector index. Users see no disruption — queries still work against the old index until migration is complete, then seamlessly switch.

---

## Project Structure

```
your-product/
├── packages/
│   ├── desktop/                        # Electron desktop app + CLI
│   │   ├── src/
│   │   │   ├── main/                  # Main process (Node.js daemon)
│   │   │   │   ├── index.ts           # Entry: app ready, tray, IPC setup, Unix socket server
│   │   │   │   ├── watcher.ts         # chokidar + fast-glob folder watcher
│   │   │   │   ├── parser.ts          # Dispatch to format-specific parsers
│   │   │   │   ├── parsers/
│   │   │   │   │   ├── pdf.ts         # pdf-parse
│   │   │   │   │   ├── docx.ts        # mammoth
│   │   │   │   │   ├── doc.ts         # word-extractor
│   │   │   │   │   ├── office.ts      # officeparser (odt, rtf, pptx)
│   │   │   │   │   └── text.ts        # md, txt, csv (built-in)
│   │   │   │   ├── chunker.ts         # Text → chunks (recursive splitter)
│   │   │   │   ├── embedder.ts        # node-llama-cpp: text → vectors
│   │   │   │   ├── store.ts           # libSQL operations (local.db)
│   │   │   │   ├── mcp.ts             # MCP server (stdio transport)
│   │   │   │   ├── ipc-server.ts      # Unix socket server for CLI ↔ daemon IPC
│   │   │   │   ├── config.ts          # YAML config + model validation
│   │   │   │   └── models.ts          # GGUF model download + cache mgmt
│   │   │   ├── cli/                   # CLI entrypoint (compiled separately)
│   │   │   │   ├── index.ts           # commander root: nomnomdrive <cmd>
│   │   │   │   ├── commands/
│   │   │   │   │   ├── init.ts        # Interactive setup wizard
│   │   │   │   │   ├── watch.ts       # watch add/remove/list
│   │   │   │   │   ├── search.ts      # One-shot semantic search
│   │   │   │   │   ├── chat.ts        # Interactive chat REPL
│   │   │   │   │   ├── status.ts      # Show daemon status + stats
│   │   │   │   │   ├── start.ts       # Launch Electron daemon
│   │   │   │   │   └── mcp.ts         # Stdio MCP server (for Claude/Cursor)
│   │   │   │   └── ipc-client.ts      # Unix socket client → daemon
│   │   │   ├── renderer/              # Tray popup window (Chromium)
│   │   │   │   ├── index.html         # Dropbox-style status panel
│   │   │   │   ├── app.ts             # File list, progress bar, animations
│   │   │   │   └── styles.css
│   │   │   └── preload.ts             # Electron contextBridge (IPC bridge)
│   │   ├── config.default.yaml        # Default config written on init
│   │   ├── electron-builder.config.ts # Build config: targets, icons, entitlements
│   │   └── package.json
│   │
│   ├── server/                         # Cloud server on Hetzner
│   │   ├── src/
│   │   │   ├── index.ts               # Hono app entry
│   │   │   ├── routes/
│   │   │   │   ├── mcp.ts             # MCP endpoint: /mcp/{api-key}
│   │   │   │   ├── relay.ts           # WebSocket relay hub
│   │   │   │   ├── sync.ts            # POST /api/sync (receive chunks)
│   │   │   │   ├── auth.ts            # Signup, API key management
│   │   │   │   └── dashboard.tsx      # SSR pages (Hono JSX + PicoCSS)
│   │   │   ├── db.ts                  # sqld client (@libsql/client)
│   │   │   └── middleware/
│   │   │       ├── auth.ts            # API key validation
│   │   │       └── ratelimit.ts       # Per-user rate limiting
│   │   ├── docker-compose.yml         # sqld + bun app
│   │   └── package.json
│   │
│   └── shared/                         # Shared types & constants
│       ├── types.ts                   # SyncPayload, ChunkRecord, etc.
│       ├── mcp-tools.ts               # MCP tool definitions (Zod schemas)
│       └── constants.ts               # Default model name, dims, etc.
│
├── package.json                        # Bun workspace root
└── turbo.json                          # Monorepo task runner
```

---

## Key npm Packages

```json
{
  "desktop": {
    "electron": "latest",
    "electron-builder": "latest",
    "node-llama-cpp": "latest",
    "@libsql/client": "latest",
    "@modelcontextprotocol/sdk": "latest",
    "commander": "^12.x",
    "@inquirer/prompts": "latest",
    "chokidar": "^4.x",
    "fast-glob": "latest",
    "picomatch": "latest",
    "pdf-parse": "latest",
    "mammoth": "latest",
    "word-extractor": "latest",
    "officeparser": "^6.x",
    "zod": "^4.x",
    "yaml": "latest"
  },
  "server": {
    "hono": "^4.x",
    "@modelcontextprotocol/sdk": "latest",
    "@modelcontextprotocol/hono": "latest",
    "@libsql/client": "latest",
    "zod": "^4.x"
  }
}
```

---

## MCP Tools Exposed

The MCP server (both local and cloud) exposes these tools to agents:

```typescript
// search_documents — primary tool
{
  name: "search_documents",
  description: "Search the user's indexed documents using semantic similarity",
  inputSchema: {
    query: z.string().describe("Natural language search query"),
    limit: z.number().optional().default(5).describe("Max results"),
    folder: z.string().optional().describe("Filter to a specific folder"),
    file_type: z.string().optional().describe("Filter by type: pdf, docx, md...")
  }
}
// Returns: array of { filename, chunk_text, score, chunk_index }

// list_folders — discovery
{
  name: "list_folders",
  description: "List all indexed folders and document counts",
  inputSchema: {}
}

// get_document — full retrieval
{
  name: "get_document",
  description: "Get the full text content of a specific document",
  inputSchema: {
    filename: z.string().describe("Filename or path to retrieve")
  }
}
```

---

## Implementation Phases

### Phase 1: Local Indexing Engine + CLI Core (Week 1-2)

**Goal:** Fully working standalone local tool. Watch folders → parse → embed → search → MCP. Everything through the CLI.

1. Electron + Node.js project setup (monorepo: `packages/desktop`, `packages/server`, `packages/shared`)
2. Default drop folder: create `~/Documents/NomNomDrive/` on `init`, watch it automatically
3. Config system (`~/.config/nomnomdrive/config.yaml`): watched paths, model, mode
4. GGUF model auto-download from HuggingFace (`embeddinggemma-300M-Q8_0`) on first `init`
5. `node-llama-cpp` embedding pipeline: text → vector (verify native addon builds with `electron-rebuild`)
6. Parser dispatcher: route by extension to `pdf-parse`, `mammoth`, `word-extractor`, `officeparser`, or built-in
7. Text chunker (recursive character splitter, ~500 tokens per chunk, markdown-aware)
8. libSQL local database with vector search schema (`local.db`)
9. `chokidar` + `fast-glob` folder watcher (add/change/delete detection)
10. Full indexing pipeline: file change → parse → chunk → embed → store
11. Unix socket IPC server in Electron main process (daemon ↔ CLI bridge)
12. **CLI commands:** `nomnomdrive init` (wizard, model download, default folder) · `watch add/remove/list` · `search "query"` · `status` · `start` · `mcp` (stdio, for Claude Desktop/Cursor)
13. System tray popup: currently indexing file, progress bar, last 5 processed files
14. `nomnomdrive init` auto-patches Claude Desktop `config.json` with the MCP stdio entry

**Deliverable:** Install the Electron app, run `nomnomdrive init`, drop files into `~/Documents/NomNomDrive/`, search with `nomnomdrive search`, and use MCP from Claude Desktop — all offline.

### Phase 2: CLI Chat (Week 3)

**Goal:** Interactive `nomnomdrive chat` REPL for conversational document Q&A

1. `nomnomdrive chat` REPL using `@inquirer/prompts` for input loop
2. v1 (retrieval-only): search local.db for top-k chunks, print them formatted with sources
3. v2 (generative): download a small local generation model (e.g. `Qwen3-0.6B-Q8_0`, ~600MB), synthesize answer from chunks using `node-llama-cpp`
4. Context window management: fit top chunks within model's context limit
5. Multi-turn: retain last N turns in context
6. `:sources` command to print chunk citations for last answer
7. `:folders` command to filter search scope

**Deliverable:** Full local RAG chat. No internet, no API keys. Works like a private local Perplexity for your files.

### Phase 3: Cloud Mode — Relay + Sync (Week 4-5)

**Goal:** Always-on remote MCP access + high-quality cloud embeddings. Activate with `nomnomdrive cloud enable`.

1. Hono server on Bun, deploy to Hetzner with Docker Compose
2. sqld setup in Docker with JWT auth
3. User table, API key generation (`nomnomdrive cloud login`)
4. WebSocket relay hub: cloud ↔ desktop persistent connection (for remote MCP)
5. Desktop: relay client, auto-connect once cloud is enabled, reconnect on drop
6. Branded MCP HTTP endpoint at `https://api.yourbrand.com/mcp/{api-key}`
7. `sync_queue` table in local DB; `POST /api/sync` endpoint (receives text chunks only)
8. Server embedding pipeline: receive text → batch embed via cloud API → store vectors in sqld
9. Desktop: background sync on startup, on file change, on reconnect
10. Basic OCR pipeline for scanned PDFs (cloud-only)
11. File size limits and storage quotas per plan
12. SSR dashboard: API key, sync status, document count, storage usage, embedding queue
13. `nomnomdrive cloud status` CLI command

**Deliverable:** Enable cloud, get a URL, paste into any agent. App can be off \u2014 docs still searchable.

### Phase 4: Ship (Week 6)

**Goal:** Packaged installers, auto-updater, billing

1. Local embedding model swap flow (detect mismatch → warn → re-index)
2. Support custom GGUF paths and HuggingFace model IDs
3. `electron-builder` packaging for Windows (`.exe` NSIS), macOS (`.dmg` + code-sign), Linux (`.AppImage`)
4. Auto-updater via `electron-updater` (GitHub Releases)
5. Landing page (Hono SSR)
6. Stripe integration for Cloud mode billing
7. Rate limiting, abuse prevention on cloud endpoints

**Deliverable:** Shippable product.

### Phase 5 (Future): Enhanced Search Quality

1. Add reranker: `qwen3-reranker-0.6b-q8_0` (~600MB) for local re-ranking
2. BM25 full-text search combined with vector search (hybrid)
3. Query expansion via small generation model
4. Configurable search pipeline: fast (vector only) → quality (hybrid + rerank)
5. Full model config becomes:

```yaml
models:
  local_embed: "hf:ggml-org/embeddinggemma-300M-Q8_0-GGUF"   # local mode only
  local_rerank: "hf:ggml-org/qwen3-reranker-0.6b-q8_0-GGUF" # v2, local rerank
  local_generate: "hf:ggml-org/Qwen3-0.6B-Q8_0-GGUF"         # v2, local generation
  # Cloud model is configured server-side. Users don't set this.
```

---

## Security

| Concern | Solution |
|---|---|
| MCP endpoint auth | API key per user in URL path |
| WebSocket auth | JWT signed on connect, verified server-side |
| sqld auth | JWT (Ed25519 keypair), not exposed to public internet |
| Data in transit | HTTPS/WSS only (Let's Encrypt) |
| Data at rest (cloud) | libSQL encryption at rest (optional `encryptionKey`) |
| Data at rest (local) | User's machine, their responsibility |
| Rate limiting | Per-user, per-minute on MCP endpoint (Hono middleware) |
| API key rotation | Dashboard allows key regeneration |

---

## Cost Estimates

### Infrastructure

| Component | Cost |
|---|---|
| Hetzner CX22 (2 vCPU, 4GB, 40GB NVMe, 20TB traffic) | ~€4/mo |
| Domain + DNS (Cloudflare) | ~€12/year |
| Let's Encrypt SSL | Free |
| **Total** | **~€5/mo** |

### Per-User Costs

| Mode | Cost to You |
|---|---|
| Local (relay only) | ~€0 (just WebSocket bandwidth) |
| Cloud (storage) | ~€0.001/mo per 1K chunks stored |
| Cloud (embedding) | ~€0.0001 per 1K chunks embedded (Gemini `text-embedding-004`) |

### User Pricing

| Tier | Price | What They Get |
|---|---|---|
| **Free** | €0 | Local mode. Unlimited folders, unlimited files. No account needed. No internet required. |
| **Pro** | €8/mo | Cloud mode. Always-on remote MCP (app can be off). High-quality cloud embeddings. OCR for scanned PDFs. |
| **Team** | €20/mo | Shared knowledge base. 50K files. Multiple API keys. Priority embedding queue. |

---

## Why This Stack Is AI-Coding-Friendly

Every technology was chosen partly because AI coding assistants generate excellent code for them:

- **Electron:** The single most documented desktop framework in JavaScript history. AI produces accurate `ipcMain`/`ipcRenderer`, `Tray`, and `BrowserWindow` code consistently.
- **commander + @inquirer/prompts:** The standard Node.js CLI stack. AI generates clean subcommand trees and interactive prompts with no hallucination.
- **Hono:** Simple API, well-documented, extensive training data
- **libSQL / @libsql/client:** SQLite syntax — the most well-known query language
- **node-llama-cpp:** Active project, good TS types, many examples
- **MCP SDK (TypeScript):** Official, well-structured, growing example base
- **Node.js v22+:** AI has years of Node.js training data; all patterns transfer directly.
- **Zod:** Dominant TS validation library — AI generates perfect schemas
- **chokidar / fast-glob / picomatch:** Decades of usage, AI knows every option
- **pdf-parse / mammoth / word-extractor:** Each has a simple, single-function API that AI rarely misuses