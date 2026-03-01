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
  local install_dir dest icon_dir icon_dest desktop_dir desktop_dest

  install_dir="${HOME}/.local/bin"
  mkdir -p "$install_dir"

  local appimage_dir appimage_dest
  appimage_dir="${HOME}/.local/lib/nomnomdrive"
  appimage_dest="${appimage_dir}/${APP_NAME}.AppImage"
  dest="${install_dir}/nomnomdrive"

  mkdir -p "$appimage_dir"

  # AppImages require FUSE 2 to mount at runtime
  if ! command -v fusermount &>/dev/null && ! [[ -f /usr/lib/libfuse.so.2 ]]; then
    info "Installing libfuse2 (required for AppImage)..."
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y libfuse2t64 2>/dev/null || sudo apt-get install -y libfuse2
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y fuse-libs
    elif command -v pacman &>/dev/null; then
      sudo pacman -S --noconfirm fuse2
    else
      die "Could not install libfuse2 automatically. Please install it manually and retry."
    fi
  fi

  if [[ -f "$appimage_dest" ]]; then
    info "AppImage already exists, skipping download."
  else
    info "Downloading $FILENAME..."
    curl -fSL --progress-bar "$DOWNLOAD_URL" -o "$appimage_dest"
  fi
  chmod +x "$appimage_dest"

  # Wrapper script that passes --no-sandbox to work around the SUID sandbox
  # requirement that AppImages cannot satisfy on most Linux distributions.
  cat > "$dest" <<WRAPPER
#!/usr/bin/env bash
exec "${appimage_dest}" --no-sandbox "\$@"
WRAPPER
  chmod +x "$dest"

  # Install icon
  icon_dir="${HOME}/.local/share/icons"
  icon_dest="${icon_dir}/nomnomdrive.png"
  mkdir -p "$icon_dir"
  if [[ -f "$icon_dest" ]]; then
    info "Icon already exists, skipping download."
  else
    info "Downloading application icon..."
    curl -fsSL "https://raw.githubusercontent.com/${REPO}/${TAG}/packages/desktop/build/icons/icon.png" \
      -o "$icon_dest"
  fi

  # Create .desktop entry so the app appears in launchers
  desktop_dir="${HOME}/.local/share/applications"
  desktop_dest="${desktop_dir}/nomnomdrive.desktop"
  mkdir -p "$desktop_dir"
  cat > "$desktop_dest" <<EOF
[Desktop Entry]
Name=${APP_NAME}
Exec=${dest}
Icon=${icon_dest}
Type=Application
Categories=Utility;
Comment=Smart file organizer powered by local AI
Terminal=false
StartupWMClass=NomNomDrive
EOF

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
