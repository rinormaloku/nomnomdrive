/**
 * Detects how much memory is actually available for local inference.
 *
 * This has to work *before* the user has chosen anything, which rules out the
 * obvious approach of asking node-llama-cpp: the packaged app ships CPU-only
 * binaries, so `getVramState()` reports zero until a GPU binary is downloaded —
 * and that download happens at the end of onboarding, long after we need to
 * recommend models. So we query the platform directly, and only fall back to
 * node-llama-cpp when a GPU binary happens to already be installed.
 *
 * Every probe is best-effort and time-boxed; a machine we cannot read simply
 * reports 0 VRAM and lands on the API-only recommendation.
 */
import os from 'os';
import fs from 'fs';
import { execFile } from 'child_process';
import type { HardwareProfile } from '@nomnomdrive/shared';
import { getInstalledGpuType } from './gpu-manager';

const BYTES_PER_MIB = 1024 * 1024;
const PROBE_TIMEOUT_MS = 5000;

/** Run a command, resolving to null instead of throwing on any failure. */
function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

// ── NVIDIA ───────────────────────────────────────────────────────────────────

/**
 * nvidia-smi is the only reliable cross-platform source for NVIDIA VRAM, and it
 * ships with every driver. Reports per-GPU; we take the largest card rather than
 * the sum, since llama.cpp will run on one device by default.
 */
async function probeNvidia(): Promise<{ bytes: number; names: string[] } | null> {
  const out = await run('nvidia-smi', [
    '--query-gpu=memory.total,name',
    '--format=csv,noheader,nounits',
  ]);
  if (!out) return null;

  let best = 0;
  const names: string[] = [];
  for (const line of out.split('\n')) {
    const [mib, ...nameParts] = line.split(',');
    const value = parseInt(mib?.trim() ?? '', 10);
    if (!Number.isFinite(value) || value <= 0) continue;
    names.push(nameParts.join(',').trim());
    best = Math.max(best, value);
  }
  if (best <= 0) return null;
  return { bytes: best * BYTES_PER_MIB, names };
}

// ── Linux (AMD / others via sysfs) ───────────────────────────────────────────

/**
 * amdgpu exposes VRAM through sysfs. Intel's i915 does not, and an APU's
 * "VRAM" is carved out of system RAM anyway — so anything under 4 GB is treated
 * as an integrated part and ignored, letting the caller fall back to RAM.
 */
function probeLinuxSysfs(): { bytes: number; names: string[] } | null {
  let best = 0;
  const names: string[] = [];
  let cards: string[];
  try {
    cards = fs.readdirSync('/sys/class/drm').filter((d) => /^card\d+$/.test(d));
  } catch {
    return null;
  }

  for (const card of cards) {
    try {
      const raw = fs.readFileSync(`/sys/class/drm/${card}/device/mem_info_vram_total`, 'utf8');
      const bytes = parseInt(raw.trim(), 10);
      if (!Number.isFinite(bytes) || bytes < 4 * 1024 ** 3) continue;
      best = Math.max(best, bytes);
      try {
        const vendor = fs.readFileSync(`/sys/class/drm/${card}/device/vendor`, 'utf8').trim();
        names.push(vendor === '0x1002' ? 'AMD GPU' : `GPU (${vendor})`);
      } catch {
        names.push('GPU');
      }
    } catch {
      /* card has no VRAM node — integrated or non-amdgpu */
    }
  }

  return best > 0 ? { bytes: best, names } : null;
}

// ── Windows ──────────────────────────────────────────────────────────────────

/**
 * Win32_VideoController.AdapterRAM is a 32-bit field and silently saturates at
 * 4 GB, which would misreport every modern card. The driver's registry key
 * carries the real 64-bit size, so we read that and use CIM only for names.
 */
async function probeWindows(): Promise<{ bytes: number; names: string[] } | null> {
  const script = [
    "$k='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\*';",
    "$m=Get-ItemProperty -Path $k -Name 'HardwareInformation.qwMemorySize' -ErrorAction SilentlyContinue |",
    "  ForEach-Object { $_.'HardwareInformation.qwMemorySize' } | Measure-Object -Maximum;",
    '$n=(Get-CimInstance Win32_VideoController).Name -join "|";',
    'Write-Output "$($m.Maximum);$n"',
  ].join(' ');

  const out = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
  if (!out) return null;

  const [sizeStr, nameStr] = out.split(';');
  const bytes = parseInt((sizeStr ?? '').trim(), 10);
  const names = (nameStr ?? '').split('|').map((n) => n.trim()).filter(Boolean);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return { bytes, names };
}

// ── macOS ────────────────────────────────────────────────────────────────────

/**
 * Apple Silicon shares one memory pool between CPU and GPU, so system RAM *is*
 * the VRAM figure. Intel Macs get no usable acceleration path here, so they fall
 * through to CPU inference.
 */
async function probeMac(): Promise<{ bytes: number; names: string[]; unified: boolean } | null> {
  if (process.arch !== 'arm64') return null;
  const chip = await run('sysctl', ['-n', 'machdep.cpu.brand_string']);
  return {
    bytes: os.totalmem(),
    names: [chip?.trim() || 'Apple Silicon'],
    unified: true,
  };
}

// ── node-llama-cpp fallback ──────────────────────────────────────────────────

/**
 * Only useful once a GPU binary has been installed — but when it has, this is
 * the most accurate figure available, since it is what llama.cpp itself sees.
 */
async function probeLlamaCpp(): Promise<{ bytes: number; names: string[]; unified: boolean } | null> {
  const installed = getInstalledGpuType();
  if (!installed) return null;
  try {
    const { getLlama } = (await (0, eval)('import("node-llama-cpp")')) as {
      getLlama: (opts?: { gpu: string }) => Promise<{
        getVramState(): Promise<{ total: number; unifiedSize: number }>;
        getGpuDeviceNames(): Promise<string[]>;
        dispose(): Promise<void>;
      }>;
    };
    const llama = await getLlama({ gpu: installed });
    try {
      const vram = await llama.getVramState();
      const names = await llama.getGpuDeviceNames();
      if (vram.total <= 0) return null;
      return { bytes: vram.total, names, unified: vram.unifiedSize > 0 };
    } finally {
      await llama.dispose();
    }
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

let cached: HardwareProfile | null = null;

/**
 * Probes the machine once per process. Results cannot change while the app runs
 * — except when a GPU binary is installed mid-session, which calls
 * `resetHardwareCache()`.
 */
export async function detectHardware(): Promise<HardwareProfile> {
  if (cached) return cached;

  const ramBytes = os.totalmem();

  // Most accurate first, when it is available at all.
  const viaLlama = await probeLlamaCpp();
  if (viaLlama) {
    cached = {
      vramBytes: viaLlama.bytes,
      ramBytes,
      unified: viaLlama.unified,
      gpuNames: viaLlama.names,
      source: 'node-llama-cpp',
    };
    return cached;
  }

  const mac = await probeMac();
  if (mac) {
    cached = {
      vramBytes: mac.bytes,
      ramBytes,
      unified: true,
      gpuNames: mac.names,
      source: 'sysctl (unified memory)',
    };
    return cached;
  }

  const nvidia = await probeNvidia();
  if (nvidia) {
    cached = {
      vramBytes: nvidia.bytes,
      ramBytes,
      unified: false,
      gpuNames: nvidia.names,
      source: 'nvidia-smi',
    };
    return cached;
  }

  if (process.platform === 'win32') {
    const win = await probeWindows();
    if (win) {
      cached = {
        vramBytes: win.bytes,
        ramBytes,
        unified: false,
        gpuNames: win.names,
        source: 'Windows driver registry',
      };
      return cached;
    }
  }

  if (process.platform === 'linux') {
    const sysfs = probeLinuxSysfs();
    if (sysfs) {
      cached = {
        vramBytes: sysfs.bytes,
        ramBytes,
        unified: false,
        gpuNames: sysfs.names,
        source: 'sysfs (drm)',
      };
      return cached;
    }
  }

  cached = {
    vramBytes: 0,
    ramBytes,
    unified: false,
    gpuNames: [],
    source: 'no GPU detected',
  };
  return cached;
}

/** Forces the next `detectHardware()` to re-probe. */
export function resetHardwareCache(): void {
  cached = null;
}
