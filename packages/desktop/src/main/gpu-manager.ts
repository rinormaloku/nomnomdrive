/**
 * GPU binary manager for node-llama-cpp.
 *
 * The packaged app ships with CPU-only binaries to keep the download small.
 * This module detects available GPUs, downloads the matching @node-llama-cpp/*
 * npm package on demand, and registers an ESM loader hook so that
 * node-llama-cpp's `getLlama()` picks up the GPU binary automatically.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFile } from 'child_process';
import { createWriteStream } from 'fs';

// ── Types ────────────────────────────────────────────────────────────────────

export type GpuType = 'vulkan' | 'cuda';

export interface GpuInfo {
  type: GpuType;
  label: string;
  size: string;
}

export interface GpuStatus {
  installed: GpuType | null;
  available: GpuInfo[];
}

// ── Paths ────────────────────────────────────────────────────────────────────

const GPU_BASE_DIR = path.join(os.homedir(), '.config', 'nomnomdrive', 'gpu-binaries');
export const GPU_MODULES_DIR = path.join(GPU_BASE_DIR, 'node_modules');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Map (gpuType, platform, arch) → npm package name */
function getPackageName(gpuType: GpuType): string | null {
  const plat =
    process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
  const arch = process.arch; // x64, arm64, …

  // macOS uses Metal (bundled in the mac-arm64-metal package), not CUDA/Vulkan
  if (plat === 'mac') return null;

  return `@node-llama-cpp/${plat}-${arch}-${gpuType}`;
}

/** Read the exact version of the installed node-llama-cpp package */
function getNodeLlamaCppVersion(): string {
  // In packaged app: __dirname = resources/app.asar/dist/main/
  // In dev:          __dirname = packages/desktop/dist/main/
  const pkgPath = path.resolve(__dirname, '..', '..', 'node_modules', 'node-llama-cpp', 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
}

// ── Status ───────────────────────────────────────────────────────────────────

export function isGpuInstalled(gpuType: GpuType): boolean {
  const pkgName = getPackageName(gpuType);
  if (!pkgName) return false;
  return fs.existsSync(path.join(GPU_MODULES_DIR, ...pkgName.split('/'), 'dist', 'index.js'));
}

export function getInstalledGpuType(): GpuType | null {
  if (isGpuInstalled('cuda')) return 'cuda';
  if (isGpuInstalled('vulkan')) return 'vulkan';
  return null;
}

// ── Detection ────────────────────────────────────────────────────────────────

export async function detectAvailableGpus(): Promise<GpuInfo[]> {
  const results: GpuInfo[] = [];

  if (process.platform === 'linux' && process.arch === 'x64') {
    // NVIDIA → CUDA
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          'nvidia-smi',
          ['--query-gpu=name', '--format=csv,noheader'],
          { timeout: 5000 },
          (err) => (err ? reject(err) : resolve()),
        );
      });
      results.push({ type: 'cuda', label: 'CUDA (NVIDIA)', size: '~150 MB' });
    } catch {
      /* no NVIDIA driver */
    }

    // Vulkan (AMD, Intel, or NVIDIA)
    const vulkanPaths = [
      '/usr/lib/x86_64-linux-gnu/libvulkan.so.1',
      '/usr/lib/libvulkan.so.1',
      '/usr/lib64/libvulkan.so.1',
    ];
    if (vulkanPaths.some((p) => fs.existsSync(p))) {
      results.push({ type: 'vulkan', label: 'Vulkan (AMD / Intel / NVIDIA)', size: '~75 MB' });
    }
  } else if (process.platform === 'win32' && process.arch === 'x64') {
    if (fs.existsSync('C:\\Windows\\System32\\nvcuda.dll')) {
      results.push({ type: 'cuda', label: 'CUDA (NVIDIA)', size: '~150 MB' });
    }
    if (fs.existsSync('C:\\Windows\\System32\\vulkan-1.dll')) {
      results.push({ type: 'vulkan', label: 'Vulkan (AMD / Intel / NVIDIA)', size: '~75 MB' });
    }
  }

  return results;
}

// ── Download ─────────────────────────────────────────────────────────────────

export async function downloadGpuBinary(
  gpuType: GpuType,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  const pkgName = getPackageName(gpuType);
  if (!pkgName)
    throw new Error(`GPU type '${gpuType}' is not supported on ${process.platform}/${process.arch}`);

  const version = getNodeLlamaCppVersion();

  // 1. Fetch tarball URL from npm registry
  const metaUrl = `https://registry.npmjs.org/${pkgName}/${version}`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) {
    throw new Error(`npm registry returned ${metaRes.status} for ${pkgName}@${version}`);
  }
  const meta = (await metaRes.json()) as { dist: { tarball: string } };
  const tarballUrl = meta.dist.tarball;

  // 2. Download tarball with progress reporting
  const response = await fetch(tarballUrl);
  if (!response.ok) throw new Error(`Failed to download ${tarballUrl}: ${response.status}`);

  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  const tmpPath = path.join(os.tmpdir(), `nlc-gpu-${gpuType}-${version}.tgz`);
  const writer = createWriteStream(tmpPath);

  const reader = response.body!.getReader();
  let downloaded = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(Buffer.from(value));
      downloaded += value.length;
      onProgress?.(downloaded, contentLength);
    }
    writer.end();
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (err) {
    writer.destroy();
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }

  // 3. Extract (npm tarballs contain a `package/` prefix → --strip-components=1)
  const targetDir = path.join(GPU_MODULES_DIR, ...pkgName.split('/'));
  fs.mkdirSync(targetDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    execFile(
      'tar',
      ['xzf', tmpPath, '--strip-components=1', '-C', targetDir],
      (err) => (err ? reject(new Error(`tar extraction failed: ${err.message}`)) : resolve()),
    );
  });

  // 4. Cleanup
  try {
    fs.unlinkSync(tmpPath);
  } catch {
    /* ignore */
  }
  console.log(`[GPU] Installed ${pkgName}@${version} to ${targetDir}`);
}

// ── Remove ───────────────────────────────────────────────────────────────────

export async function removeGpuBinary(gpuType: GpuType): Promise<void> {
  const pkgName = getPackageName(gpuType);
  if (!pkgName) return;
  const targetDir = path.join(GPU_MODULES_DIR, ...pkgName.split('/'));
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    console.log(`[GPU] Removed ${pkgName} from ${targetDir}`);
  }
}

// ── ESM loader hook ──────────────────────────────────────────────────────────

/**
 * Register a Node.js ESM loader hook that redirects `@node-llama-cpp/*` GPU
 * package imports to the user's downloaded binaries directory.
 *
 * Must be called BEFORE any `import("node-llama-cpp")` call.
 */
export function registerGpuLoaderHook(): void {
  // Only register if the GPU binaries directory exists (user has downloaded at least once)
  if (!fs.existsSync(GPU_MODULES_DIR)) return;

  const hookSource = [
    'import { existsSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { pathToFileURL } from "node:url";',
    '',
    'let gpuDir = null;',
    '',
    'export async function initialize(data) {',
    '  gpuDir = data?.gpuBinariesDir ?? null;',
    '}',
    '',
    'export async function resolve(specifier, context, nextResolve) {',
    '  if (gpuDir && specifier.startsWith("@node-llama-cpp/")) {',
    '    const parts = specifier.startsWith("@") ? [specifier.split("/").slice(0, 2).join("/"), ...specifier.split("/").slice(2)] : [specifier];',
    '    const entry = join(gpuDir, parts[0], "dist", "index.js");',
    '    if (existsSync(entry)) {',
    '      return { url: pathToFileURL(entry).href, shortCircuit: true };',
    '    }',
    '  }',
    '  return nextResolve(specifier, context);',
    '}',
  ].join('\n');

  try {
    fs.mkdirSync(GPU_BASE_DIR, { recursive: true });
    const hookPath = path.join(GPU_BASE_DIR, '_resolve-hook.mjs');
    fs.writeFileSync(hookPath, hookSource, 'utf8');

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('node:module') as { register: (...args: unknown[]) => void };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pathToFileURL } = require('node:url') as { pathToFileURL: (p: string) => URL };

    register(pathToFileURL(hookPath).href, {
      parentURL: pathToFileURL(__filename).href,
      data: { gpuBinariesDir: GPU_MODULES_DIR },
    });

    console.log('[GPU] ESM loader hook registered — GPU binaries dir:', GPU_MODULES_DIR);
  } catch (err) {
    // Non-fatal: GPU acceleration just won't be available
    console.warn('[GPU] Failed to register ESM loader hook (GPU will use CPU fallback):', err);
  }
}
