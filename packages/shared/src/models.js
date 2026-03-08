"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveModelPath = resolveModelPath;
exports.modelExists = modelExists;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const https_1 = __importDefault(require("https"));
const config_1 = require("./config");
/**
 * Resolves a model identifier to a local file path.
 * Supports:
 *   - hf:<repo>/<file>  → downloads from HuggingFace
 *   - /absolute/path    → used as-is
 *   - relative/path     → resolved from models dir
 */
async function resolveModelPath(modelId, onProgress) {
    if (modelId.startsWith('hf:')) {
        return downloadHuggingFaceModel(modelId.slice(3), onProgress);
    }
    if (path_1.default.isAbsolute(modelId)) {
        return modelId;
    }
    return path_1.default.join((0, config_1.getModelsDir)(), modelId);
}
async function downloadHuggingFaceModel(hfPath, onProgress) {
    // hfPath format: "org/repo-name/file.gguf"  or  "ggml-org/embeddinggemma-300M-Q8_0-GGUF"
    // We need to figure out the filename from the repo
    const modelsDir = (0, config_1.getModelsDir)();
    await promises_1.default.mkdir(modelsDir, { recursive: true });
    // Derive filename from hfPath (last segment, or repo default)
    const parts = hfPath.split('/');
    const repoId = parts.slice(0, 2).join('/'); // e.g. "ggml-org/embeddinggemma-300M-Q8_0-GGUF"
    const explicitFile = parts[2]; // e.g. "embeddinggemma-300M-Q8_0.gguf" (optional)
    // Use HuggingFace API to find the GGUF file if not explicitly provided
    let fileName = explicitFile;
    if (!fileName) {
        fileName = await resolveHuggingFaceFilename(repoId);
    }
    const localPath = path_1.default.join(modelsDir, fileName);
    // Ensure the parent directory exists — fileName may contain subdirs (e.g. "gguf/model.gguf")
    await promises_1.default.mkdir(path_1.default.dirname(localPath), { recursive: true });
    // Check if already cached
    try {
        await promises_1.default.access(localPath);
        return localPath;
    }
    catch {
        // Not cached, download it
    }
    const downloadUrl = `https://huggingface.co/${repoId}/resolve/main/${fileName}`;
    await downloadFile(downloadUrl, localPath, onProgress);
    return localPath;
}
async function resolveHuggingFaceFilename(repoId) {
    const apiUrl = `https://huggingface.co/api/models/${repoId}`;
    const data = await fetchJson(apiUrl);
    const siblings = data.siblings ?? [];
    const gguf = siblings.find((s) => s.rfilename.endsWith('.gguf'));
    if (!gguf)
        throw new Error(`No GGUF file found in HuggingFace repo: ${repoId}`);
    return gguf.rfilename;
}
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https_1.default
            .get(url, { headers: { 'User-Agent': 'nomnomdrive/0.1' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    reject(e);
                }
            });
        })
            .on('error', reject);
    });
}
function downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        // Ensure parent dir exists (dest may contain subdirectories)
        require('fs').mkdirSync(path_1.default.dirname(dest), { recursive: true });
        const file = require('fs').createWriteStream(dest + '.tmp');
        let downloaded = 0;
        let total = 0;
        const followRedirects = (redirectUrl) => {
            https_1.default
                .get(redirectUrl, { headers: { 'User-Agent': 'nomnomdrive/0.1' } }, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    followRedirects(res.headers.location);
                    return;
                }
                total = parseInt(res.headers['content-length'] ?? '0', 10);
                res.on('data', (chunk) => {
                    downloaded += chunk.length;
                    file.write(chunk);
                    onProgress?.(downloaded, total);
                });
                res.on('end', () => {
                    // Wait for the write stream to fully flush before renaming
                    file.end(() => {
                        const fsSyncModule = require('fs');
                        const tmp = dest + '.tmp';
                        // Another concurrent download may have already moved the file
                        if (fsSyncModule.existsSync(dest)) {
                            try {
                                fsSyncModule.unlinkSync(tmp);
                            }
                            catch { /* already gone */ }
                            resolve();
                            return;
                        }
                        try {
                            fsSyncModule.renameSync(tmp, dest);
                            resolve();
                        }
                        catch (renameErr) {
                            const e = renameErr;
                            // Concurrent download won between our existsSync and renameSync — that's fine
                            if ((e.code === 'ENOENT' || e.code === 'EEXIST') && fsSyncModule.existsSync(dest)) {
                                try {
                                    fsSyncModule.unlinkSync(tmp);
                                }
                                catch { /* ignore */ }
                                resolve();
                                return;
                            }
                            reject(renameErr);
                        }
                    });
                });
                res.on('error', (err) => {
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
async function modelExists(modelId) {
    try {
        if (modelId.startsWith('hf:')) {
            const hfPath = modelId.slice(3);
            const parts = hfPath.split('/');
            const repoId = parts.slice(0, 2).join('/');
            const explicitFile = parts[2];
            const modelsDir = (0, config_1.getModelsDir)();
            if (explicitFile) {
                const localPath = path_1.default.join(modelsDir, explicitFile);
                await promises_1.default.access(localPath);
                return true;
            }
            // Check if any GGUF file exists for this repo
            const files = await promises_1.default.readdir(modelsDir).catch(() => []);
            const repoName = repoId.split('/')[1];
            return files.some((f) => f.includes(repoName) && f.endsWith('.gguf'));
        }
        await promises_1.default.access(modelId);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=models.js.map