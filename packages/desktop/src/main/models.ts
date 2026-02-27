import path from 'path';
import fs from 'fs/promises';
import https from 'https';
import type { AppConfig } from './config';
import { getModelsDir } from './config';

type ProgressCallback = (downloaded: number, total: number) => void;

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
): Promise<string> {
  if (modelId.startsWith('hf:')) {
    return downloadHuggingFaceModel(modelId.slice(3), onProgress);
  }
  if (path.isAbsolute(modelId)) {
    return modelId;
  }
  return path.join(getModelsDir(), modelId);
}

async function downloadHuggingFaceModel(
  hfPath: string,
  onProgress?: ProgressCallback,
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

  // Check if already cached
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // Not cached, download it
  }

  const downloadUrl = `https://huggingface.co/${repoId}/resolve/main/${fileName}`;
  await downloadFile(downloadUrl, localPath, onProgress);
  return localPath;
}

async function resolveHuggingFaceFilename(repoId: string): Promise<string> {
  const apiUrl = `https://huggingface.co/api/models/${repoId}`;
  const data = await fetchJson(apiUrl);
  const siblings = (data as { siblings?: Array<{ rfilename: string }> }).siblings ?? [];
  const gguf = siblings.find((s) => s.rfilename.endsWith('.gguf'));
  if (!gguf) throw new Error(`No GGUF file found in HuggingFace repo: ${repoId}`);
  return gguf.rfilename;
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

function downloadFile(url: string, dest: string, onProgress?: ProgressCallback): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = require('fs').createWriteStream(dest + '.tmp');
    let downloaded = 0;
    let total = 0;

    const followRedirects = (redirectUrl: string) => {
      https
        .get(redirectUrl, { headers: { 'User-Agent': 'nomnomdrive/0.1' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            followRedirects(res.headers.location);
            return;
          }

          total = parseInt(res.headers['content-length'] ?? '0', 10);

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            file.write(chunk);
            onProgress?.(downloaded, total);
          });

          res.on('end', () => {
            file.end();
            require('fs').renameSync(dest + '.tmp', dest);
            resolve();
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

export async function modelExists(config: AppConfig): Promise<boolean> {
  try {
    // For hf: models, check if the cached file exists
    const modelId = config.model.localEmbed;
    if (modelId.startsWith('hf:')) {
      const hfPath = modelId.slice(3);
      const parts = hfPath.split('/');
      const repoId = parts.slice(0, 2).join('/');
      const explicitFile = parts[2];

      const modelsDir = getModelsDir();

      if (explicitFile) {
        const localPath = path.join(modelsDir, explicitFile);
        await fs.access(localPath);
        return true;
      }

      // Check if any GGUF file exists for this repo
      const files = await fs.readdir(modelsDir).catch(() => []);
      const repoName = repoId.split('/')[1];
      return files.some((f) => f.includes(repoName) && f.endsWith('.gguf'));
    }

    await fs.access(modelId);
    return true;
  } catch {
    return false;
  }
}
