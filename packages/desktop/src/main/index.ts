import { app, Tray, Menu, BrowserWindow, ipcMain, shell, nativeImage, nativeTheme, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { EventEmitter } from 'events';
import { createServer } from 'http';
import { loginSuccessPage } from '../login-success-page';
import { createHash, randomBytes } from 'crypto';
import type { AddressInfo } from 'net';
import { spawn } from 'child_process';
import { loadConfig, saveConfig } from './config';
import { Store } from './store';
import { createEmbedder, EmbedderProxy, type IEmbedder } from './embedder';
import {
  registerGpuLoaderHook,
  detectAvailableGpus,
  getInstalledGpuType,
  isGpuValidated,
  validateAndCleanupOnFailure,
  downloadGpuBinary,
  removeGpuBinary,
} from './gpu-manager';
import { Watcher } from './watcher';
import { Indexer } from './indexer';
import { IpcServer } from './ipc-server';
import { bootstrapMcpServer } from './mcp/bootstrap';
import { patchMcpClientByName } from './mcp-register';
import { ChatEngineProxy, createChatEngine } from './chat-engine';
import { TunnelClient } from './tunnel-client';
import type { IndexingProgress } from '@nomnomdrive/shared';
import {
  loadCloudCredentials,
  saveCloudCredentials,
  deleteCloudCredentials,
  checkSetupStatus,
  runSetup,
  downloadMissingModels,
  getDefaultSetupOptions,
  EMBED_MODELS,
  CHAT_MODELS,
  listHuggingFaceGgufFiles,
  getEmbedConfig,
  getChatConfig,
  type SetupOptions,
  type AppConfig,
  type ChatConfig,
} from '@nomnomdrive/shared';

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});

// Use kernel user namespaces instead of SUID sandbox (required for AppImage on Linux)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
}

// Only disable HW acceleration for the Electron renderer (chromium compositing).
// Do NOT pass --disable-gpu — it also disables Vulkan device enumeration,
// which node-llama-cpp needs to detect VRAM and offload layers to the GPU.
app.disableHardwareAcceleration();

// Register ESM loader hook for GPU binaries BEFORE any getLlama() call.
// This must happen early — before app.whenReady() triggers embedder init.
registerGpuLoaderHook();

// ── Model crash detection ─────────────────────────────────────────────────────
// The CPU-only llama.cpp binary may trigger SIGILL on some CPUs (e.g. AMD with
// AVX-512 but no AMX). Since SIGILL terminates the process instantly, we write a
// marker file before model loading and delete it on success. If the marker is
// still present on next launch, we skip model loading so the user can reach
// Settings and install a GPU binary instead.
const MODEL_CRASH_MARKER = path.join(os.homedir(), '.config', 'nomnomdrive', '.model-loading-crash');

function isModelCrashDetected(): boolean {
  return fs.existsSync(MODEL_CRASH_MARKER);
}

function writeModelCrashMarker(): void {
  try {
    fs.mkdirSync(path.dirname(MODEL_CRASH_MARKER), { recursive: true });
    fs.writeFileSync(MODEL_CRASH_MARKER, Date.now().toString(), 'utf8');
  } catch { /* best effort */ }
}

function clearModelCrashMarker(): void {
  try {
    fs.unlinkSync(MODEL_CRASH_MARKER);
  } catch { /* already gone */ }
}

const emitter = new EventEmitter();
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let forceQuit = false;
let activeTunnelClient: TunnelClient | null = null;

/** Set by whenReady(); called from setup:start after first-run setup completes. */
let _startEmbedderAndWatcher: (() => Promise<void>) | null = null;
/** Set by whenReady(); reloads config from disk into the in-memory config object. */
let _reloadConfig: (() => Promise<void>) | null = null;

// ─── Main window ──────────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const appIconPath = path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'build'),
    'icons',
    'icon.png',
  );
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 520,
    minHeight: 460,
    show: false,
    frame: true,
    resizable: true,
    movable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    win.loadURL(devServerUrl).catch((error) => {
      console.error('[Main] Failed to load dev server:', error);
    });
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch((error) => {
      console.error('[Main] Failed to load renderer:', error);
    });
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (event) => {
    if (!forceQuit) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

// ─── IPC bridge to renderer ───────────────────────────────────────────────────

emitter.on('indexing:progress', (progress: IndexingProgress) => {
  mainWindow?.webContents.send('indexing:progress', progress);
});

emitter.on('indexing:complete', (data: { filePath: string; chunkCount: number }) => {
  mainWindow?.webContents.send('indexing:complete', data);
});

emitter.on('indexing:error', (data: { filePath: string; error: string }) => {
  mainWindow?.webContents.send('indexing:error', data);
});

emitter.on('indexing:deleted', (data: { filePath: string }) => {
  mainWindow?.webContents.send('indexing:deleted', data);
});

ipcMain.on('open-drop-folder', (_event, folderPath: string) => {
  shell.openPath(folderPath);
});

ipcMain.on('open-external-url', (_event, url: string) => {
  shell.openExternal(url);
});

ipcMain.on('open-file', (_event, filePath: string) => {
  // On Linux, shell.openPath triggers a Chromium PCHECK crash (chdir(current_directory) == 0)
  // when the process cwd is invalid. Bypass by calling xdg-open directly.
  if (process.platform === 'linux') {
    spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
  } else {
    shell.openPath(filePath);
  }
});

// ── Setup / Onboarding IPC handlers ──────────────────────────────────────────

ipcMain.handle('setup:check', async () => {
  return checkSetupStatus();
});

ipcMain.handle('model:list-gguf', (_event, repoId: string) =>
  listHuggingFaceGgufFiles(repoId),
);

ipcMain.handle('setup:get-catalog', () => {
  const defaults = getDefaultSetupOptions();
  return {
    embedModels: EMBED_MODELS,
    chatModels: CHAT_MODELS,
    defaults,
  };
});

let setupAbortController: AbortController | null = null;

ipcMain.handle('setup:start', async (_event, options: SetupOptions & { embedConfig?: unknown; chatConfig?: unknown; gpuType?: string }) => {
  setupAbortController = new AbortController();
  const { signal } = setupAbortController;
  try {
    const status = await checkSetupStatus();
    const sendProgress = (progress: { phase: string; modelId: string; modelLabel: string; downloaded: number; total: number }) => {
      mainWindow?.webContents.send('setup:progress', progress);
    };
    const sendPhaseStart = (phase: string, modelId: string) => {
      // Informational — renderer uses setup:progress for actual tracking
      console.log(`[Setup] Starting ${phase} model download: ${modelId}`);
    };

    if (status.needsSetup || !status.existingConfig) {
      // Full setup — save config + download models
      await runSetup({
        ...options,
        embedConfig: options.embedConfig as import('@nomnomdrive/shared').EmbedConfig | undefined,
        chatConfig: options.chatConfig as import('@nomnomdrive/shared').ChatConfig | undefined,
      }, sendProgress, sendPhaseStart, signal);
      // Refresh in-memory config so chat engine and other services see the new values
      if (_reloadConfig) await _reloadConfig();
    } else if (status.needsModelDownload && status.existingConfig) {
      // Config exists but models are missing — just download
      await downloadMissingModels(status.existingConfig, sendProgress, sendPhaseStart, signal);
    }

    // Download GPU binary BEFORE embedder init so the ESM loader hook can redirect
    // node-llama-cpp imports to the GPU-accelerated binary.
    if (options.gpuType && options.gpuType !== 'none') {
      try {
        await downloadGpuBinary(options.gpuType as 'vulkan' | 'cuda', (downloaded, total) => {
          mainWindow?.webContents.send('setup:progress', {
            phase: 'gpu',
            modelId: options.gpuType,
            modelLabel: `GPU acceleration (${options.gpuType})`,
            downloaded,
            total,
          });
        });
        // Register the hook so embedder picks up the GPU binary
        registerGpuLoaderHook();
        // Validate binary compatibility before proceeding
        mainWindow?.webContents.send('setup:progress', {
          phase: 'gpu-validate',
          modelId: options.gpuType,
          modelLabel: `Validating ${options.gpuType} compatibility...`,
          downloaded: 0,
          total: 0,
        });
        const validation = await validateAndCleanupOnFailure(options.gpuType as 'vulkan' | 'cuda');
        if (!validation.valid) {
          console.warn(`[Setup] GPU binary validation failed (will use CPU): ${validation.error}`);
          mainWindow?.webContents.send('setup:gpu-failed', { gpuType: options.gpuType, error: validation.error });
        }
      } catch (gpuErr) {
        // Non-fatal: log and continue with CPU fallback
        console.warn('[Setup] GPU binary download failed (will use CPU):', gpuErr);
        mainWindow?.webContents.send('setup:gpu-failed', { gpuType: options.gpuType, error: String(gpuErr) });
      }
    }

    // Models are now on disk — initialize embedder and start watcher
    // (these were deferred during first-run setup to avoid a concurrent download race)
    if (_startEmbedderAndWatcher) {
      await _startEmbedderAndWatcher();
    }

    mainWindow?.webContents.send('setup:complete');
    return { success: true };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { success: false, error: 'cancelled' };
    }
    const message = err instanceof Error ? err.message : String(err);
    mainWindow?.webContents.send('setup:error', { error: message });
    return { success: false, error: message };
  } finally {
    setupAbortController = null;
  }
});

ipcMain.handle('setup:cancel', () => {
  setupAbortController?.abort();
});

// ── Cloud IPC handlers (no store/config dependency — register early) ──────────

ipcMain.handle('cloud:get-status', async () => {
  const cfg = await loadConfig();
  const creds = await loadCloudCredentials();
  return {
    mode: cfg.mode ?? 'local',
    serverUrl: cfg.cloud?.serverUrl ?? null,
    hasCredentials: !!creds?.accessToken,
  };
});

ipcMain.handle('cloud:logout', async () => {
  activeTunnelClient?.stop();
  activeTunnelClient = null;
  await deleteCloudCredentials();
  const cfg = await loadConfig();
  cfg.mode = 'local';
  await saveConfig(cfg);
  mainWindow?.webContents.send('cloud:status-changed');
});

// ── GPU acceleration IPC handlers ─────────────────────────────────────────────

ipcMain.handle('gpu:detect', () => detectAvailableGpus());

ipcMain.handle('gpu:status', () => {
  const installed = getInstalledGpuType();
  return {
    installed,
    validated: installed ? isGpuValidated(installed) : undefined,
  };
});

ipcMain.handle('gpu:install', async (_event, gpuType: string) => {
  try {
    await downloadGpuBinary(gpuType as 'vulkan' | 'cuda', (downloaded, total) => {
      mainWindow?.webContents.send('setup:progress', {
        phase: 'gpu',
        modelId: gpuType,
        modelLabel: `GPU acceleration (${gpuType})`,
        downloaded,
        total,
      });
    });
    // Re-register the hook so the newly downloaded binary is discoverable
    registerGpuLoaderHook();

    // Validate the binary actually works before declaring success
    mainWindow?.webContents.send('setup:progress', {
      phase: 'gpu-validate',
      modelId: gpuType,
      modelLabel: `Validating ${gpuType} compatibility...`,
      downloaded: 0,
      total: 0,
    });
    const validation = await validateAndCleanupOnFailure(gpuType as 'vulkan' | 'cuda');
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Clear the crash marker so model loading is attempted on next restart
    clearModelCrashMarker();
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('gpu:remove', async (_event, gpuType: string) => {
  try {
    await removeGpuBinary(gpuType as 'vulkan' | 'cuda');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ─── IPC handlers for renderer data requests ──────────────────────────────────

// These are set up inside app.whenReady so they have access to `store` and `config`.
// The actual handle registration happens below in the lifecycle block.

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Single instance lock
  if (!app.requestSingleInstanceLock()) {
    console.warn('[Main] Another instance is already running; exiting this instance');
    app.quit();
    return;
  }

  // Enable auto-start at login
  app.setLoginItemSettings({ openAtLogin: true });

  // Load config (may be replaced after first-run setup completes)
  let config = await loadConfig();

  // Check whether first-run setup is still needed (no config.yaml or missing models).
  // If so, we defer embedder init and watcher start until setup:start completes,
  // to avoid racing the setup-engine's model downloads.
  const initialSetupStatus = await checkSetupStatus();
  const firstRunSetupNeeded = initialSetupStatus.needsSetup || initialSetupStatus.needsModelDownload;

  // Initialize services
  const store = new Store(config);
  await store.initialize();

  // Reconcile DB with filesystem: remove records for files deleted while offline
  const staleDocs = await store.reconcileWithFilesystem();
  if (staleDocs > 0) {
    console.log(`[Store] Reconciliation removed ${staleDocs} stale record(s)`);
  }

  // Create indexer first (watcher needs it)
  const embedder = new EmbedderProxy(createEmbedder(config));
  const indexer = new Indexer(store, embedder);
  indexer.setEmitter(emitter);

  const watcher = new Watcher(config, indexer);
  let ipcServer: IpcServer | null = null;

  // Helper that starts the embedder and watcher — called immediately on normal
  // startup, or deferred until after first-run setup completes.
  const startEmbedderAndWatcher = async () => {
    // If the previous launch crashed during model loading (SIGILL on incompatible
    // CPU binary), skip model init so the user can reach Settings and install a
    // GPU binary. The marker is also cleared when GPU is installed from Settings.
    if (isModelCrashDetected()) {
      console.warn('[Main] Previous model load crashed — skipping model init.');
      console.warn('[Main] Open Settings → GPU Acceleration to install a GPU binary, then restart.');
      clearModelCrashMarker();
      mainWindow?.webContents.send('model:error', {
        error: 'Model loading crashed on previous launch. Please install GPU acceleration in Settings, then restart.',
      });
      // Still start watcher so new files are queued (they'll be indexed once the model works)
      await watcher.start();
      return;
    }

    // Write crash marker before model init — cleared on success
    writeModelCrashMarker();

    // Start embedder (async — tray is usable while model loads)
    embedder.initialize((downloaded, total) => {
      mainWindow?.webContents.send('setup:progress', {
        phase: 'embed',
        modelId: 'embed',
        modelLabel: 'Embedding model',
        downloaded,
        total,
      });
    }).then(() => {
      // Model loaded successfully — clear the crash marker
      clearModelCrashMarker();

      // Validate embedding dims against what the DB was built with.
      // If the model changed (e.g. 768 → 1024), reset the vector index so
      // re-indexing starts fresh rather than failing on every insert.
      const storedDims = store.getStoredDims();
      const actualDims = embedder.getDims();
      if (storedDims !== null && storedDims !== actualDims) {
        store.resetForNewDims(actualDims);
      } else if (storedDims === null) {
        // Shouldn't happen after runMigrations seeds the value, but guard anyway
        store.resetForNewDims(actualDims);
      }
      console.log('[Embedder] Model ready');
      mainWindow?.webContents.send('model:ready', {});
    }).catch((err) => {
      clearModelCrashMarker();
      console.error('[Embedder] Failed to load model:', err);
      const message = err instanceof Error ? err.message : String(err);
      mainWindow?.webContents.send('model:error', { error: message });
    });

    // Start watching + scan existing files
    await watcher.start();
    indexer.scanAll(config.watch.paths).catch(console.error);
  };

  // Expose so the setup:start handler (registered at top-level) can trigger it
  _startEmbedderAndWatcher = startEmbedderAndWatcher;
  _reloadConfig = async () => {
    const fresh = await loadConfig();
    Object.assign(config, fresh);
  };

  if (!firstRunSetupNeeded) {
    // Normal startup: begin embedding and file watching immediately
    startEmbedderAndWatcher().catch(console.error);
  } else {
    console.log('[Main] First-run setup pending — deferring embedder/watcher init');
  }

  // ── IPC handle registrations (renderer invoke calls) ──
  ipcMain.handle('get-documents', async () => {
    const docs = await store.getAllDocuments();
    const folders = await store.listFolders();
    const folderPathMap = new Map(folders.map((f) => [f.folderId, f.path]));
    return docs.map((d) => ({
      relativePath: d.relativePath,
      fileSize: d.fileSize,
      fileType: d.fileType,
      indexedAt: d.indexedAt,
      folderId: d.folderId,
      absolutePath: path.join(folderPathMap.get(d.folderId) ?? '', d.relativePath),
      chunkCount: d.chunkCount,
    }));
  });

  ipcMain.handle('get-stats', async () => {
    return store.getStats();
  });

  ipcMain.handle('gpu:active-backend', () => ({
    backend: embedder.isReady() ? (embedder.getGpuBackend() || 'cpu') : null,
  }));

  ipcMain.handle('cloud:login', async (_event, serverUrl: string = 'https://cloud.nomnomdrive.com') => {
    const normalizedUrl = serverUrl.replace(/\/$/, '');

    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => { resolveCode = res; rejectCode = rej; });

    const callbackServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const code = url.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(loginSuccessPage(normalizedUrl));
        resolveCode(code);
      } else {
        res.writeHead(400).end('Missing code');
      }
    });

    try {
      await new Promise<void>((r) => callbackServer.listen(0, '127.0.0.1', r));
      const port = (callbackServer.address() as AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      const regResponse = await fetch(`${normalizedUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'NomNomDrive Desktop',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      });
      if (!regResponse.ok) {
        const text = await regResponse.text();
        throw new Error(`Client registration failed: ${text}`);
      }
      const { client_id: clientId } = await regResponse.json() as { client_id: string };

      const authorizeUrl =
        `${normalizedUrl}/auth/authorize` +
        `?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=openid+profile+email` +
        `&code_challenge=${encodeURIComponent(challenge)}` +
        `&code_challenge_method=S256`;

      shell.openExternal(authorizeUrl);

      const code = await Promise.race([
        codePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => { rejectCode(new Error('Login timed out (60s)')); reject(new Error('Login timed out (60s)')); }, 60_000),
        ),
      ]);

      callbackServer.close();

      const tokenResponse = await fetch(`${normalizedUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
        }).toString(),
      });
      if (!tokenResponse.ok) {
        const text = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${text}`);
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      await saveCloudCredentials({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      });

      const cfg = await loadConfig();
      cfg.mode = 'cloud';
      cfg.cloud = { serverUrl: normalizedUrl };
      await saveConfig(cfg);

      // Start tunnel
      activeTunnelClient?.stop();
      activeTunnelClient = new TunnelClient(normalizedUrl, tokens.access_token, store, embedder);
      activeTunnelClient.connect();

      mainWindow?.webContents.send('cloud:status-changed');
      return { success: true };
    } catch (err: unknown) {
      callbackServer.close();
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('register-mcp-client', async (_event, client: string) => {
    const port = config.mcp.port;
    return patchMcpClientByName(client, port);
  });

  // ── Chat engine (lazy-loaded) ──
  const chatEngine = new ChatEngineProxy(createChatEngine(config, embedder, store));

  ipcMain.handle('chat:init', async () => {
    await chatEngine.initialize((downloaded, total) => {
      mainWindow?.webContents.send('setup:progress', {
        phase: 'chat',
        modelId: config.model.localChat,
        modelLabel: 'Chat model',
        downloaded,
        total,
      });
    });
    return { ready: true };
  });

  ipcMain.handle('chat:send', async (_event, message: string) => {
    const response = await chatEngine.chat(
      message,
      (chunk) => {
        mainWindow?.webContents.send('chat:chunk', chunk);
      },
      (toolCall) => {
        mainWindow?.webContents.send('chat:tool-call', toolCall);
      },
    );
    return response;
  });

  ipcMain.handle('chat:reset', async () => {
    await chatEngine.resetSession();
  });

  // ── Settings IPC ──
  ipcMain.handle('config:get', () => config);

  ipcMain.handle('config:save', async (_event, updates: Partial<AppConfig>) => {
    const newConfig: AppConfig = {
      ...config,
      ...updates,
      watch: updates.watch ? { ...config.watch, ...updates.watch } : config.watch,
      model: updates.model ? { ...config.model, ...updates.model } : config.model,
      mcp: updates.mcp ? { ...config.mcp, ...updates.mcp } : config.mcp,
      ...(updates.chat !== undefined ? { chat: updates.chat as ChatConfig | undefined } : {}),
    };
    await saveConfig(newConfig);
    Object.assign(config, newConfig);

    // Hot-reload watch paths immediately without a restart
    if (updates.watch?.paths) {
      const currentPaths = watcher.getWatchedPaths();
      const newPaths = updates.watch.paths;
      for (const p of newPaths) {
        if (!currentPaths.includes(p)) watcher.addPath(p);
      }
      for (const p of currentPaths) {
        if (!newPaths.includes(p)) watcher.removePath(p);
      }
      for (const p of newPaths) {
        await store.upsertFolder(p);
      }
    }

    // Hot-reload chat engine: swap to new engine when chat config or local model changes
    const chatChanged = updates.chat !== undefined || updates.model?.localChat !== undefined;
    if (chatChanged) {
      const newInner = createChatEngine(config, embedder, store);
      const chatCfg = getChatConfig(config);
      if (chatCfg.provider !== 'local') {
        // Remote: initialize is instant, then swap
        await newInner.initialize();
        await chatEngine.swap(newInner);
        console.log('[Settings] Chat engine hot-reloaded (remote)');
      } else if (config.model.localChat) {
        // Local: swap first (disposes old), then initialize in background
        await chatEngine.swap(newInner);
        newInner.initialize((downloaded, total) => {
          mainWindow?.webContents.send('setup:progress', {
            phase: 'chat',
            modelId: config.model.localChat,
            modelLabel: 'Chat model',
            downloaded,
            total,
          });
        }).then(() => {
          console.log('[Settings] Chat model hot-reloaded (local)');
        }).catch((err) => {
          console.error('[Settings] Failed to hot-reload chat model:', err);
        });
      } else {
        await chatEngine.swap(newInner);
      }
    }

    // Hot-reload embed model: dispose old, create new, swap in-place
    const embedChanged = updates.embed !== undefined || !!updates.model?.localEmbed;
    if (embedChanged) {
      // Run in background so the IPC call returns immediately (un-sticks "Saving…")
      (async () => {
        try {
          // Wait for any in-flight indexing to finish
          while (indexer.isProcessing()) {
            await new Promise((r) => setTimeout(r, 50));
          }

          const newInner = createEmbedder(config);
          await newInner.initialize((downloaded, total) => {
            mainWindow?.webContents.send('setup:progress', {
              phase: 'embed',
              modelId: 'embed',
              modelLabel: 'Embedding model',
              downloaded,
              total,
            });
          });

          // Check if dimensions changed — reset vector store if so
          const storedDims = store.getStoredDims();
          const newDims = newInner.getDims();
          if (storedDims !== null && storedDims !== newDims) {
            store.resetForNewDims(newDims);
          }

          await embedder.swap(newInner);
          console.log('[Settings] Embed model hot-reloaded');
          mainWindow?.webContents.send('model:ready', {});

          // Re-index all files with the new embedding model
          indexer.scanAll(config.watch.paths).catch(console.error);
        } catch (err) {
          console.error('[Settings] Failed to hot-reload embed model:', err);
        }
      })();
    }

    mainWindow?.webContents.send('config', {
      dropFolder: config.watch.paths[0],
      mcpPort: config.mcp.port,
      chatConfigured: chatEngine.isConfigured(),
    });
    return { restartRequired: false };
  });

  ipcMain.handle('open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('drop:copy-to-watch', async (_event, filePaths: string[]) => {
    const dest = config.watch.paths[0];
    if (!dest) return { success: false, error: 'No watch folder configured' };
    const results: { path: string; error?: string }[] = [];
    for (const src of filePaths) {
      try {
        const stat = await fs.promises.stat(src);
        const name = path.basename(src);
        const target = path.join(dest, name);
        if (stat.isDirectory()) {
          await fs.promises.cp(src, target, { recursive: true });
        } else {
          await fs.promises.copyFile(src, target);
        }
        results.push({ path: target });
      } catch (err: unknown) {
        results.push({ path: src, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { success: true, results };
  });

  // Start Unix socket IPC server for CLI
  ipcServer = new IpcServer(config, store, watcher, indexer);
  await ipcServer.start();

  const shouldStartMcp = app.isPackaged || process.env.NOMNOM_DISABLE_MCP_IN_DEV !== '1';
  if (shouldStartMcp) {
    await bootstrapMcpServer(config, store, embedder);
  }

  // Start cloud tunnel if mode=cloud and credentials are saved
  if (config.mode === 'cloud' && config.cloud?.serverUrl) {
    const creds = await loadCloudCredentials();
    if (creds?.accessToken) {
      activeTunnelClient = new TunnelClient(
        config.cloud.serverUrl,
        creds.accessToken,
        store,
        embedder,
      );
      activeTunnelClient.connect();
      app.on('before-quit', () => activeTunnelClient?.stop());
    }
  }

  // Auto-updater (production only — checks GitHub Releases for new versions).
  // app-update.yml is only generated for tag releases with a publish config;
  // skip when it's missing (e.g. local builds with --publish never).
  const updateCfgPath = path.join(process.resourcesPath, 'app-update.yml');
  if (app.isPackaged && fs.existsSync(updateCfgPath)) {
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update:available', { version: info.version });
    });

    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('update:downloaded', {});
    });

    autoUpdater.on('error', (err) => {
      console.error('[AutoUpdater]', err.message);
    });

    autoUpdater.checkForUpdates().catch(console.error);
    setInterval(() => autoUpdater.checkForUpdates().catch(console.error), 4 * 60 * 60 * 1000);
  }

  ipcMain.on('update:install', () => {
    autoUpdater.quitAndInstall();
  });

  // Create main window
  mainWindow = createMainWindow();
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('config', {
      dropFolder: config.watch.paths[0],
      mcpPort: shouldStartMcp ? config.mcp.port : null,
      chatConfigured: chatEngine.isConfigured(),
    });
  });

  // System tray — theme-aware icons
  // In production, extraResources copies build/icons → resources/icons.
  // In development, icons live directly in build/icons next to the source tree.
  const iconsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'icons')
    : path.join(__dirname, '..', '..', 'build', 'icons');

  const fallback1x1 = nativeImage
    .createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zx+QAAAAASUVORK5CYII=',
    )
    .resize({ width: 16, height: 16 });

  // Load both variants (dark = white icon for dark taskbars, light = black icon for light taskbars)
  // Windows requires .ico for reliable system tray rendering; other platforms use .png.
  const trayExt = process.platform === 'win32' ? 'ico' : 'png';
  let iconDark  = nativeImage.createFromPath(path.join(iconsDir, `tray-dark.${trayExt}`));
  let iconLight = nativeImage.createFromPath(path.join(iconsDir, `tray-light.${trayExt}`));
  if (iconDark.isEmpty())  iconDark  = fallback1x1;
  if (iconLight.isEmpty()) iconLight = fallback1x1;

  // On macOS, resize to 18px (standard menu bar size — Retina macs double it
  // automatically). This avoids an oversized blob in the menu bar.
  if (process.platform === 'darwin') {
    iconDark  = iconDark.resize({ width: 18, height: 18 });
    iconLight = iconLight.resize({ width: 18, height: 18 });
  }

  // Linux panels (GNOME/Ubuntu top bar) are always dark regardless of the desktop
  // theme, so always use the white icon there. On macOS/Windows, track theme changes.
  const getTrayIcon = () =>
    process.platform === 'linux' || nativeTheme.shouldUseDarkColors ? iconDark : iconLight;

  try {
    tray = new Tray(getTrayIcon());
    tray.setToolTip('NomNomDrive');
  } catch (error) {
    console.error('[Tray] Failed to create tray icon:', error);
    tray = null;
    // Tray failed — window is already visible via ready-to-show; nothing else needed
  }

  // Keep the icon in sync when the OS theme changes (macOS / Windows only — Linux
  // panels are always dark so no need to swap)
  if (process.platform !== 'linux') {
    nativeTheme.on('updated', () => {
      tray?.setImage(getTrayIcon());
    });
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Open Drop Folder',
      click: () => shell.openPath(config.watch.paths[0]),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        forceQuit = true;
        app.quit();
      },
    },
  ]);

  tray?.setContextMenu(contextMenu);
  tray?.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  // Cleanup on quit
  app.on('before-quit', async () => {
    forceQuit = true;
    if (ipcServer) {
      await ipcServer.stop();
    }
    await chatEngine.dispose();
    await embedder.dispose();
    await watcher.stop();
    store.close();
  });
});

app.on('window-all-closed', () => {
  // Keep app alive in tray even when all windows closed — do NOT call app.quit()
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});
