import path from 'path';
import fs from 'fs/promises';
import https from 'https';
import type { AppConfig } from './config';
import { getModelsDir } from './config';

export type ProgressCallback = (downloaded: number, total: number) => void;

/**
 * Resolves a model identifier to a local file path.
 * Supports:
 *   - hf:<repo>/<file>  → downloads from HuggingFace
 *   - /absolute/path    → used as-is
 *   - relative/path     → resolved from models dir
 */
export async function resolveModelPath(
  modelId: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<string> {
  if (modelId.startsWith('hf:')) {
    return downloadHuggingFaceModel(modelId.slice(3), onProgress, signal);
  }
  if (path.isAbsolute(modelId)) {
    return modelId;
  }
  // Relative path — try the full relative path inside models dir first,
  // then fall back to just the basename (flat layout from HF downloads).
  const modelsDir = getModelsDir();
  const full = path.join(modelsDir, modelId);
  try {
    await fs.access(full);
    return full;
  } catch {
    const flat = path.join(modelsDir, path.basename(modelId));
    try {
      await fs.access(flat);
      return flat;
    } catch {
      // Neither exists — return the full path so the caller gets a clear error
      return full;
    }
  }
}

async function downloadHuggingFaceModel(
  hfPath: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<string> {
  // hfPath format: "org/repo-name/file.gguf"  or  "ggml-org/embeddinggemma-300M-Q8_0-GGUF"
  // We need to figure out the filename from the repo
  const modelsDir = getModelsDir();
  await fs.mkdir(modelsDir, { recursive: true });

  // Derive filename from hfPath (last segment, or repo default)
  const parts = hfPath.split('/');
  const repoId = parts.slice(0, 2).join('/'); // e.g. "ggml-org/embeddinggemma-300M-Q8_0-GGUF"
  const explicitFile = parts[2]; // e.g. "embeddinggemma-300M-Q8_0.gguf" (optional)

  // Use HuggingFace API to find the GGUF file if not explicitly provided
  let fileName = explicitFile;
  if (!fileName) {
    fileName = await resolveHuggingFaceFilename(repoId);
  }

  const localPath = path.join(modelsDir, fileName);

  // Ensure the parent directory exists — fileName may contain subdirs (e.g. "gguf/model.gguf")
  await fs.mkdir(path.dirname(localPath), { recursive: true });

  // Check if already cached
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // Not cached, download it
  }

  const downloadUrl = `https://huggingface.co/${repoId}/resolve/main/${fileName}`;
  await downloadFile(downloadUrl, localPath, onProgress, signal);
  return localPath;
}

export interface GgufFileInfo {
  filename: string;
  size: number;
}

/**
 * List all GGUF files available in a HuggingFace repo.
 */
export async function listHuggingFaceGgufFiles(repoId: string): Promise<GgufFileInfo[]> {
  const data = await fetchJson(`https://huggingface.co/api/models/${repoId}`);
  const siblings = (data as { siblings?: Array<{ rfilename: string; size?: number }> }).siblings ?? [];
  return siblings
    .filter((s) => s.rfilename.endsWith('.gguf'))
    .map((s) => ({ filename: s.rfilename, size: s.size ?? 0 }));
}

async function resolveHuggingFaceFilename(repoId: string): Promise<string> {
  const ggufFiles = await listHuggingFaceGgufFiles(repoId);
  if (ggufFiles.length === 0) throw new Error(`No GGUF file found in HuggingFace repo: ${repoId}`);
  if (ggufFiles.length === 1) return ggufFiles[0].filename;

  // Multiple GGUF files — pick the best default quant.
  // Preference order: Q4_K_M > Q4_K_S > Q5_K_M > Q5_K_S > Q8_0 > Q6_K > first file
  const quantPriority = ['Q4_K_M', 'Q4_K_S', 'Q5_K_M', 'Q5_K_S', 'Q8_0', 'Q6_K'];
  for (const quant of quantPriority) {
    const match = ggufFiles.find((s) => s.filename.includes(quant));
    if (match) return match.filename;
  }
  return ggufFiles[0].filename;
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'nomnomdrive/0.1' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function downloadFile(url: string, dest: string, onProgress?: ProgressCallback, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Download cancelled', 'AbortError'));
      return;
    }

    // Ensure parent dir exists (dest may contain subdirectories)
    require('fs').mkdirSync(path.dirname(dest), { recursive: true });
    const file = require('fs').createWriteStream(dest + '.tmp');
    let currentRes: import('http').IncomingMessage | null = null;

    const cleanup = () => {
      currentRes?.destroy();
      file.destroy();
      const fsSyncModule = require('fs') as typeof import('fs');
      try { fsSyncModule.unlinkSync(dest + '.tmp'); } catch { /* already gone */ }
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        cleanup();
        reject(new DOMException('Download cancelled', 'AbortError'));
      }, { once: true });
    }

    const followRedirects = (redirectUrl: string) => {
      https
        .get(redirectUrl, { headers: { 'User-Agent': 'nomnomdrive/0.1' } }, (res) => {
          currentRes = res;

          if (signal?.aborted) return;

          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            followRedirects(res.headers.location);
            return;
          }

          let downloaded = 0;
          const total = parseInt(res.headers['content-length'] ?? '0', 10);

          res.on('data', (chunk: Buffer) => {
            if (signal?.aborted) return;
            downloaded += chunk.length;
            file.write(chunk);
            onProgress?.(downloaded, total);
          });

          res.on('end', () => {
            if (signal?.aborted) return;
            // Wait for the write stream to fully flush before renaming
            file.end(() => {
              const fsSyncModule = require('fs') as typeof import('fs');
              const tmp = dest + '.tmp';
              // Another concurrent download may have already moved the file
              if (fsSyncModule.existsSync(dest)) {
                try { fsSyncModule.unlinkSync(tmp); } catch { /* already gone */ }
                resolve();
                return;
              }
              try {
                fsSyncModule.renameSync(tmp, dest);
                resolve();
              } catch (renameErr: unknown) {
                const e = renameErr as NodeJS.ErrnoException;
                // Concurrent download won between our existsSync and renameSync — that's fine
                if ((e.code === 'ENOENT' || e.code === 'EEXIST') && fsSyncModule.existsSync(dest)) {
                  try { fsSyncModule.unlinkSync(tmp); } catch { /* ignore */ }
                  resolve();
                  return;
                }
                reject(renameErr);
              }
            });
          });

          res.on('error', (err: Error) => {
            file.destroy();
            reject(err);
          });
        })
        .on('error', reject);
    };

    followRedirects(url);
  });
}

/**
 * Check whether a specific model identifier has been downloaded locally.
 */
export async function modelExists(modelId: string): Promise<boolean> {
  try {
    const modelsDir = getModelsDir();

    if (modelId.startsWith('hf:')) {
      const hfPath = modelId.slice(3);
      const parts = hfPath.split('/');
      const repoId = parts.slice(0, 2).join('/');
      const explicitFile = parts[2];

      if (explicitFile) {
        const localPath = path.join(modelsDir, explicitFile);
        await fs.access(localPath);
        return true;
      }

      // Check if any GGUF file exists for this repo.
      // Repo names typically end with "-GGUF" (e.g. "Qwen3-4B-GGUF") while
      // downloaded files use a quantisation suffix (e.g. "Qwen3-4B-Q5_K_M.gguf").
      // Strip the trailing "-GGUF"/"-gguf" so the prefix matches actual filenames.
      const files = await fs.readdir(modelsDir).catch(() => [] as string[]);
      const repoName = repoId.split('/')[1];
      const prefix = repoName.replace(/-[Gg][Gg][Uu][Ff]$/, '');
      return files.some((f) => f.endsWith('.gguf') && (f.includes(repoName) || f.startsWith(prefix)));
    }

    // Non-HF path: check as-is first, then resolve relative paths inside modelsDir
    if (path.isAbsolute(modelId)) {
      await fs.access(modelId);
      return true;
    }
    // Try full relative path inside models dir, then just the basename
    try {
      await fs.access(path.join(modelsDir, modelId));
      return true;
    } catch {
      await fs.access(path.join(modelsDir, path.basename(modelId)));
      return true;
    }
  } catch {
    return false;
  }
}
