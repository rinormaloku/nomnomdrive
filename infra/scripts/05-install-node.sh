#!/usr/bin/env bash
# Install fnm + Node 22 + pnpm for the current user.
# Run as the non-root user who will run dev commands (not as root).
set -euo pipefail

# Install fnm
curl -fsSL https://fnm.vercel.app/install | bash

# Load fnm into current shell
export FNM_PATH="$HOME/.local/share/fnm"
export PATH="$FNM_PATH:$PATH"
eval "$(fnm env --use-on-cd)"

# Install and use Node 22
fnm install 22
fnm use 22
fnm default 22

# Enable corepack and install pnpm
corepack enable
corepack prepare pnpm@latest --activate

echo "Node $(node --version) installed via fnm."
echo "pnpm $(pnpm --version) installed."
echo ""
echo "Add the following to your shell profile (~/.bashrc or ~/.zshrc):"
echo '  export FNM_PATH="$HOME/.local/share/fnm"'
echo '  export PATH="$FNM_PATH:$PATH"'
echo '  eval "$(fnm env --use-on-cd)"'
