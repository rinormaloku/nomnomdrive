#!/usr/bin/env bash
set -euo pipefail

REPO="rinormaloku/nomnomdrive"
APP_NAME="NomNomDrive"

# ── helpers ────────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
die()   { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" &>/dev/null || die "'$1' is required but not found. Please install it and retry."
}

# ── platform detection ─────────────────────────────────────────────────────────

detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) OS="macos" ;;
    Linux)  OS="linux" ;;
    *)      die "Unsupported OS: $os. Use install.ps1 on Windows." ;;
  esac

  case "$arch" in
    x86_64)          ARCH="x64" ;;
    aarch64 | arm64) ARCH="arm64" ;;
    *)               die "Unsupported architecture: $arch" ;;
  esac
}

# ── resolve latest version ─────────────────────────────────────────────────────

fetch_latest_version() {
  local tag
  tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' \
    | head -1 \
    | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
  [[ -n "$tag" ]] || die "Could not determine latest release. Check your internet connection."
  # strip leading 'v': v0.1.0 → 0.1.0
  VERSION="${tag#v}"
  TAG="$tag"
}

# ── build download URL ─────────────────────────────────────────────────────────

build_url() {
  local filename
  case "$OS" in
    macos)
      # arm64 → NomNomDrive-0.1.0-arm64.dmg, x64 → NomNomDrive-0.1.0.dmg
      if [[ "$ARCH" == "arm64" ]]; then
        filename="${APP_NAME}-${VERSION}-arm64.dmg"
      else
        filename="${APP_NAME}-${VERSION}.dmg"
      fi
      ;;
    linux)
      if [[ "$ARCH" == "arm64" ]]; then
        filename="${APP_NAME}-${VERSION}-arm64.AppImage"
      else
        filename="${APP_NAME}-${VERSION}.AppImage"
      fi
      ;;
  esac
  FILENAME="$filename"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${filename}"
}

# ── macOS install ──────────────────────────────────────────────────────────────

install_macos() {
  local tmp dmg_path mount_point app_path

  info "Downloading $FILENAME..."
  tmp="$(mktemp -d)"
  dmg_path="${tmp}/${FILENAME}"
  curl -fSL --progress-bar "$DOWNLOAD_URL" -o "$dmg_path"

  info "Mounting disk image..."
  mount_point="$(mktemp -d)"
  hdiutil attach -quiet -nobrowse -mountpoint "$mount_point" "$dmg_path"

  app_path="$(find "$mount_point" -maxdepth 1 -name '*.app' | head -1)"
  [[ -n "$app_path" ]] || { hdiutil detach -quiet "$mount_point"; die "Could not find .app in DMG."; }

  info "Installing to /Applications..."
  rm -rf "/Applications/${APP_NAME}.app"
  cp -R "$app_path" /Applications/

  hdiutil detach -quiet "$mount_point"
  rm -rf "$tmp"

  # Remove quarantine attribute so Gatekeeper doesn't block the unsigned app
  info "Clearing Gatekeeper quarantine..."
  xattr -cr "/Applications/${APP_NAME}.app"

  ok "${APP_NAME} installed to /Applications/${APP_NAME}.app"
  echo
  printf '  Launch it from Spotlight, Launchpad, or run:\n'
  printf '  open /Applications/%s.app\n\n' "$APP_NAME"
}

# ── Linux install ──────────────────────────────────────────────────────────────

install_linux() {
  local install_dir dest

  install_dir="${HOME}/.local/bin"
  mkdir -p "$install_dir"

  dest="${install_dir}/nomnomdrive"

  info "Downloading $FILENAME..."
  curl -fSL --progress-bar "$DOWNLOAD_URL" -o "$dest"
  chmod +x "$dest"

  ok "${APP_NAME} installed to ${dest}"
  echo

  # Warn if the install dir isn't on PATH
  if ! echo "$PATH" | grep -q "${install_dir}"; then
    printf '  \033[1;33mNote:\033[0m %s is not on your PATH.\n' "$install_dir"
    printf '  Add this to your shell profile:\n'
    printf '    export PATH="%s:$PATH"\n\n' "$install_dir"
  else
    printf '  Run it with: nomnomdrive\n\n'
  fi
}

# ── main ───────────────────────────────────────────────────────────────────────

main() {
  need curl

  detect_platform
  fetch_latest_version
  build_url

  info "Installing ${APP_NAME} v${VERSION} (${OS}/${ARCH})..."

  case "$OS" in
    macos) install_macos ;;
    linux) install_linux ;;
  esac
}

main "$@"
