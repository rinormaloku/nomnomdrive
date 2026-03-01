#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Repo    = 'rinormaloku/nomnomdrive'
$AppName = 'NomNomDrive'

function Write-Info  { Write-Host "==> $args" -ForegroundColor Blue }
function Write-Ok    { Write-Host " v $args" -ForegroundColor Green }
function Write-Fatal { Write-Host "error: $args" -ForegroundColor Red -ErrorAction Continue; exit 1 }

# ── resolve latest version ─────────────────────────────────────────────────────

function Get-LatestVersion {
  try {
    $resp = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    $tag  = $resp.tag_name
  } catch {
    Write-Fatal "Could not fetch latest release: $_"
  }
  if (-not $tag) { Write-Fatal "Could not determine latest release." }
  # strip leading 'v': v0.1.0 → 0.1.0
  $version = $tag -replace '^v', ''
  return @{ Tag = $tag; Version = $version }
}

# ── main ───────────────────────────────────────────────────────────────────────

Write-Info "Fetching latest $AppName release..."
$release  = Get-LatestVersion
$tag      = $release.Tag
$version  = $release.Version

# Only x64 is currently published for Windows
$filename = "$AppName Setup $version.exe"
$url      = "https://github.com/$Repo/releases/download/$tag/$([Uri]::EscapeUriString($filename))"

Write-Info "Installing $AppName v$version (windows/x64)..."
Write-Info "Downloading $filename..."

$tmp  = [System.IO.Path]::GetTempPath()
$dest = Join-Path $tmp $filename

try {
  # Use BITS for progress display if available, otherwise fall back to WebClient
  $bits = Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue
  if ($bits) {
    Start-BitsTransfer -Source $url -Destination $dest -DisplayName "Downloading $AppName"
  } else {
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile($url, $dest)
  }
} catch {
  Write-Fatal "Download failed: $_"
}

if (-not (Test-Path $dest)) {
  Write-Fatal "Downloaded file not found at $dest"
}

Write-Info "Running installer..."
# /S = silent install (NSIS convention)
$proc = Start-Process -FilePath $dest -ArgumentList '/S' -Wait -PassThru
if ($proc.ExitCode -ne 0) {
  Write-Info "Silent install returned exit code $($proc.ExitCode)."
  Write-Info "Launching interactive installer instead..."
  Start-Process -FilePath $dest -Wait
}

Remove-Item $dest -Force -ErrorAction SilentlyContinue

Write-Ok "$AppName v$version installed successfully."
Write-Host ""
Write-Host "  Launch it from the Start Menu or Desktop shortcut." -ForegroundColor Gray
Write-Host ""
