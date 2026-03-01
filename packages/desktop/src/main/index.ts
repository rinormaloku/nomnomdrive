import { app, Tray, Menu, BrowserWindow, ipcMain, shell, nativeImage, nativeTheme } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { loadConfig } from './config';
import { Store } from './store';
import { Embedder } from './embedder';
import { Watcher } from './watcher';
import { Indexer } from './indexer';
import { IpcServer } from './ipc-server';
import { bootstrapMcpServer } from './mcp/bootstrap';
import { patchMcpClientByName } from './mcp-register';
import { ChatEngine } from './chat-engine';
import type { IndexingProgress } from '@nomnomdrive/shared';
import {
  checkSetupStatus,
  runSetup,
  downloadMissingModels,
  getDefaultSetupOptions,
  EMBED_MODELS,
  CHAT_MODELS,
  type SetupOptions,
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

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const emitter = new EventEmitter();
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let forceQuit = false;

/** Set by whenReady(); called from setup:start after first-run setup completes. */
let _startEmbedderAndWatcher: (() => Promise<void>) | null = null;

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

ipcMain.handle('setup:get-catalog', () => {
  const defaults = getDefaultSetupOptions();
  return {
    embedModels: EMBED_MODELS,
    chatModels: CHAT_MODELS,
    defaults,
  };
});

ipcMain.handle('setup:start', async (_event, options: SetupOptions) => {
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
      await runSetup(options, sendProgress, sendPhaseStart);
    } else if (status.needsModelDownload && status.existingConfig) {
      // Config exists but models are missing — just download
      await downloadMissingModels(status.existingConfig, sendProgress, sendPhaseStart);
    }

    // Models are now on disk — initialize embedder and start watcher
    // (these were deferred during first-run setup to avoid a concurrent download race)
    if (_startEmbedderAndWatcher) {
      await _startEmbedderAndWatcher();
    }

    mainWindow?.webContents.send('setup:complete');
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    mainWindow?.webContents.send('setup:error', { error: message });
    return { success: false, error: message };
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

  // Load config
  const config = await loadConfig();

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
  const embedder = new Embedder(config);
  const indexer = new Indexer(store, embedder);
  indexer.setEmitter(emitter);

  const watcher = new Watcher(config, indexer);
  let ipcServer: IpcServer | null = null;

  // Helper that starts the embedder and watcher — called immediately on normal
  // startup, or deferred until after first-run setup completes.
  const startEmbedderAndWatcher = async () => {
    // Start embedder (async — tray is usable while model loads)
    embedder.initialize((downloaded, total) => {
      mainWindow?.webContents.send('setup:progress', {
        phase: 'embed',
        modelId: config.model.localEmbed,
        modelLabel: 'Embedding model',
        downloaded,
        total,
      });
    }).then(() => {
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
      console.error('[Embedder] Failed to load model:', err);
    });

    // Start watching + scan existing files
    await watcher.start();
    indexer.scanAll(config.watch.paths).catch(console.error);
  };

  // Expose so the setup:start handler (registered at top-level) can trigger it
  _startEmbedderAndWatcher = startEmbedderAndWatcher;

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

  ipcMain.handle('register-mcp-client', async (_event, client: string) => {
    const port = config.mcp.port;
    return patchMcpClientByName(client, port);
  });

  // ── Chat engine (lazy-loaded) ──
  const chatEngine = new ChatEngine(config, embedder, store);

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
    const response = await chatEngine.chat(message, (chunk) => {
      mainWindow?.webContents.send('chat:chunk', chunk);
    });
    return response;
  });

  ipcMain.handle('chat:reset', async () => {
    await chatEngine.resetSession();
  });

  // Start Unix socket IPC server for CLI
  ipcServer = new IpcServer(config, store, watcher, indexer);
  await ipcServer.start();

  const shouldStartMcp = app.isPackaged || process.env.NOMNOM_DISABLE_MCP_IN_DEV !== '1';
  if (shouldStartMcp) {
    await bootstrapMcpServer(config, store, embedder);
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
