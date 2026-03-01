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
