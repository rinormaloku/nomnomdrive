# NomNomDrive

Local AI-powered document search and chat.

## Installation

### macOS

**Homebrew (recommended):**

```bash
brew install rinormaloku/nomnomdrive/nomnomdrive
```

> First time? Add the tap: `brew tap rinormaloku/nomnomdrive`

**Or with the install script:**

```bash
curl -fsSL https://raw.githubusercontent.com/rinormaloku/nomnomdrive/main/install.sh | bash
```

The script downloads the DMG, installs to `/Applications`, and clears the Gatekeeper quarantine so the unsigned app opens without friction.

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/rinormaloku/nomnomdrive/main/install.sh | bash
```

Installs an AppImage to `~/.local/bin/nomnomdrive`. Supports x64 and arm64.

### Windows

**PowerShell:**

```powershell
irm https://raw.githubusercontent.com/rinormaloku/nomnomdrive/main/install.ps1 | iex
```

**Or download directly** from the [latest release](https://github.com/rinormaloku/nomnomdrive/releases/latest) and run the `NomNomDrive Setup *.exe` installer.

---

## Homebrew tap setup

Create a GitHub repo named `homebrew-nomnomdrive` under your account, then copy [`Casks/nomnomdrive.rb`](Casks/nomnomdrive.rb) into it at the same path (`Casks/nomnomdrive.rb`).

That's it. Homebrew will auto-update the version via `livecheck` on every GitHub release tag.

## Trying out core features

### 1. Start the cloud server

```bash
pnpm install
pnpm --filter @nomnomdrive/shared build
pnpm dev:cloud
```

> First-time setup requires a `.env` file with Google OAuth credentials and a JWT secret. See [CLOUD-DEV.md](CLOUD-DEV.md) for the full walkthrough.

### 2. Start the desktop app

In a second terminal:

```bash
pnpm dev
```

The desktop app starts in local mode — it does not connect to the cloud instance automatically.

### 3. Connect the desktop to the cloud

Build the CLI and log in, pointing it at the local server:

```bash
pnpm --filter @nomnomdrive/desktop build:main
node packages/desktop/dist/cli/index.js cloud login --server http://localhost:3030
```

The `--server` flag is required when targeting a local instance. In production the default (`https://cloud.nomnomdrive.app`) is used, so you can simply run:

```bash
nomnomdrive cloud login
```

Check the connection status:

```bash
node packages/desktop/dist/cli/index.js cloud status
```

### 4. Start the tunnel daemon

```bash
node packages/desktop/dist/cli/index.js start
```

The desktop will connect to the cloud via WebSocket. You can then test MCP tool calls (`search_documents`, `list_folders`, `get_document`) through `http://localhost:3030/mcp`.

For the complete guide including API key generation, MCP inspector testing, and Claude Desktop integration, see [CLOUD-DEV.md](CLOUD-DEV.md).

---

## Development

```bash
pnpm install
pnpm --filter @nomnomdrive/shared build
cd packages/desktop && pnpm dev
```

## Building

```bash
cd packages/desktop
pnpm dist
```

Artifacts are written to `packages/desktop/release/`.
