import { app, Tray, Menu, BrowserWindow, ipcMain, shell, nativeImage, nativeTheme, screen } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
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

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const emitter = new EventEmitter();
let tray: Tray | null = null;
let popupWindow: BrowserWindow | null = null;

// On Linux, we capture the cursor position when the context menu opens (at that
// moment the cursor is still on the tray icon). This is the only reliable way
// to know where the tray icon lives since tray.getBounds() returns {0,0,0,0}.
let lastTrayClickPoint: Electron.Point | null = null;
let lastKnownTrayBounds: Electron.Rectangle | null = null;

function hasValidTrayBounds(bounds: Electron.Rectangle): boolean {
  return bounds.width > 0 && bounds.height > 0;
}

function pointToFallbackBounds(point: Electron.Point): Electron.Rectangle {
  const fallbackSize = process.platform === 'darwin' ? 22 : 24;
  return {
    x: Math.round(point.x - fallbackSize / 2),
    y: Math.round(point.y - fallbackSize / 2),
    width: fallbackSize,
    height: fallbackSize,
  };
}

function updateTrayAnchor(bounds?: Electron.Rectangle): void {
  if (bounds && hasValidTrayBounds(bounds)) {
    lastKnownTrayBounds = bounds;
    lastTrayClickPoint = {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
    return;
  }

  const point = screen.getCursorScreenPoint();
  lastTrayClickPoint = point;
  lastKnownTrayBounds = pointToFallbackBounds(point);
}

function getTrayAnchorBounds(currentTray: Tray): Electron.Rectangle {
  const trayBounds = currentTray.getBounds();
  if (hasValidTrayBounds(trayBounds)) {
    lastKnownTrayBounds = trayBounds;
    return trayBounds;
  }

  if (lastKnownTrayBounds && hasValidTrayBounds(lastKnownTrayBounds)) {
    return lastKnownTrayBounds;
  }

  const anchor = lastTrayClickPoint ?? screen.getCursorScreenPoint();
  return pointToFallbackBounds(anchor);
}

function detectTrayEdge(anchorBounds: Electron.Rectangle, workArea: Electron.Rectangle): 'top' | 'bottom' | 'left' | 'right' {
  const centerX = anchorBounds.x + anchorBounds.width / 2;
  const centerY = anchorBounds.y + anchorBounds.height / 2;

  const distances = {
    top: Math.abs(centerY - workArea.y),
    bottom: Math.abs(workArea.y + workArea.height - centerY),
    left: Math.abs(centerX - workArea.x),
    right: Math.abs(workArea.x + workArea.width - centerX),
  };

  let edge: 'top' | 'bottom' | 'left' | 'right' = 'top';
  let minDistance = distances.top;

  for (const candidate of ['bottom', 'left', 'right'] as const) {
    if (distances[candidate] < minDistance) {
      minDistance = distances[candidate];
      edge = candidate;
    }
  }

  return edge;
}

function detectPanelEdgeFromDisplay(display: Electron.Display): 'top' | 'bottom' | 'left' | 'right' {
  const { bounds, workArea } = display;
  const insets = {
    top: Math.max(0, workArea.y - bounds.y),
    bottom: Math.max(0, bounds.y + bounds.height - (workArea.y + workArea.height)),
    left: Math.max(0, workArea.x - bounds.x),
    right: Math.max(0, bounds.x + bounds.width - (workArea.x + workArea.width)),
  };

  let edge: 'top' | 'bottom' | 'left' | 'right' = 'top';
  let maxInset = insets.top;

  for (const candidate of ['bottom', 'left', 'right'] as const) {
    if (insets[candidate] > maxInset) {
      maxInset = insets[candidate];
      edge = candidate;
    }
  }

  return edge;
}

// ─── Tray popup window ────────────────────────────────────────────────────────

function createPopupWindow(): BrowserWindow {
  const isDev = !app.isPackaged;
  const win = new BrowserWindow({
    width: 520,
    height: 460,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
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

  win.on('blur', () => {
    win.hide();
  });

  return win;
}

function togglePopup(forceShow = false): void {
  if (!tray || !popupWindow) return;

  if (popupWindow.isVisible() && !forceShow) {
    popupWindow.hide();
    return;
  }

  const windowBounds = popupWindow.getBounds();

  const trayBounds = tray.getBounds();
  const hasRealTrayBounds = hasValidTrayBounds(trayBounds);
  const anchorBounds = hasRealTrayBounds ? trayBounds : getTrayAnchorBounds(tray);
  const display = screen.getDisplayMatching(anchorBounds);
  const workArea = display.workArea;
  const trayEdge = detectTrayEdge(anchorBounds, workArea);
  const gap = 6;

  let x: number;
  let y: number;

  switch (trayEdge) {
    case 'top':
      x = Math.round(anchorBounds.x + anchorBounds.width - windowBounds.width);
      y = Math.round(anchorBounds.y + anchorBounds.height + gap);
      break;
    case 'bottom':
      x = Math.round(anchorBounds.x + anchorBounds.width - windowBounds.width);
      y = Math.round(anchorBounds.y - windowBounds.height - gap);
      break;
    case 'left':
      x = Math.round(anchorBounds.x + anchorBounds.width + gap);
      y = Math.round(anchorBounds.y);
      break;
    case 'right':
      x = Math.round(anchorBounds.x - windowBounds.width - gap);
      y = Math.round(anchorBounds.y);
      break;
  }

  if (process.platform === 'linux' && !hasRealTrayBounds) {
    const panelEdge = detectPanelEdgeFromDisplay(display);

    if (panelEdge === 'top' || panelEdge === 'bottom') {
      // GNOME/Ubuntu and most Linux trays place indicators on the right side.
      // When tray bounds are unavailable on Wayland, anchor horizontally to the
      // right to keep the status window under the indicator area.
      x = workArea.x + workArea.width - windowBounds.width - gap;
      y = panelEdge === 'top'
        ? workArea.y + gap
        : workArea.y + workArea.height - windowBounds.height - gap;
    } else {
      x = panelEdge === 'left'
        ? workArea.x + gap
        : workArea.x + workArea.width - windowBounds.width - gap;
      y = workArea.y + gap;
    }
  }

  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - windowBounds.width));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - windowBounds.height));

  popupWindow.setPosition(x, y);
  popupWindow.show();
  popupWindow.focus();
}

// ─── IPC bridge to renderer ───────────────────────────────────────────────────

emitter.on('indexing:progress', (progress: IndexingProgress) => {
  popupWindow?.webContents.send('indexing:progress', progress);
});

emitter.on('indexing:complete', (data: { filePath: string; chunkCount: number }) => {
  popupWindow?.webContents.send('indexing:complete', data);
});

emitter.on('indexing:error', (data: { filePath: string; error: string }) => {
  popupWindow?.webContents.send('indexing:error', data);
});

emitter.on('indexing:deleted', (data: { filePath: string }) => {
  popupWindow?.webContents.send('indexing:deleted', data);
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

// ─── IPC handlers for renderer data requests ──────────────────────────────────

// These are set up inside app.whenReady so they have access to `store` and `config`.
// The actual handle registration happens below in the lifecycle block.

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Hide from macOS dock — tray-only app
  if (process.platform === 'darwin') app.dock?.hide();

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

  // Initialize services
  const store = new Store(config);
  await store.initialize();

  // Create indexer first (watcher needs it)
  const embedder = new Embedder(config);
  const indexer = new Indexer(store, embedder);
  indexer.setEmitter(emitter);

  const watcher = new Watcher(config, indexer);
  let ipcServer: IpcServer | null = null;

  // Start embedder (async — tray is usable while model loads)
  embedder.initialize().then(() => {
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
    popupWindow?.webContents.send('model:ready', {});
  }).catch((err) => {
    console.error('[Embedder] Failed to load model:', err);
  });

  // Reconcile DB with filesystem: remove records for files deleted while offline
  const staleDocs = await store.reconcileWithFilesystem();
  if (staleDocs > 0) {
    console.log(`[Store] Reconciliation removed ${staleDocs} stale record(s)`);
  }

  // Start watching + scan existing files
  await watcher.start();
  indexer.scanAll(config.watch.paths).catch(console.error);

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
    await chatEngine.initialize();
    return { ready: true };
  });

  ipcMain.handle('chat:send', async (_event, message: string) => {
    const response = await chatEngine.chat(message, (chunk) => {
      popupWindow?.webContents.send('chat:chunk', chunk);
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

  // Auto-updater (production only — checks GitHub Releases for new versions)
  if (app.isPackaged) {
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    autoUpdater.on('update-available', (info) => {
      popupWindow?.webContents.send('update:available', { version: info.version });
    });

    autoUpdater.on('update-downloaded', () => {
      popupWindow?.webContents.send('update:downloaded', {});
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

  // Create popup window
  popupWindow = createPopupWindow();
  popupWindow.webContents.on('did-finish-load', () => {
    popupWindow?.webContents.send('config', {
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
  let iconDark  = nativeImage.createFromPath(path.join(iconsDir, 'tray-dark.png'));
  let iconLight = nativeImage.createFromPath(path.join(iconsDir, 'tray-light.png'));
  if (iconDark.isEmpty())  iconDark  = fallback1x1;
  if (iconLight.isEmpty()) iconLight = fallback1x1;

  // On macOS mark as template so the system handles light/dark automatically
  if (process.platform === 'darwin') {
    iconDark.setTemplateImage(true);
    iconLight.setTemplateImage(true);
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
  }

  // Keep the icon in sync when the OS theme changes (macOS / Windows only — Linux
  // panels are always dark so no need to swap)
  if (process.platform !== 'linux') {
    nativeTheme.on('updated', () => {
      tray?.setImage(getTrayIcon());
    });
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Status', click: () => togglePopup(true) },
    {
      label: 'Open Drop Folder',
      click: () => shell.openPath(config.watch.paths[0]),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  // Capture cursor position the moment the context menu opens — on GNOME/Ubuntu
  // this fires when the user clicks the tray icon, so the cursor is right on it.
  contextMenu.on('menu-will-show', () => {
    updateTrayAnchor(tray?.getBounds());
  });

  tray?.setContextMenu(contextMenu);
  tray?.on('click', (_event, bounds) => {
    updateTrayAnchor(bounds);
    togglePopup();
  });
  tray?.on('right-click', (_event, bounds) => {
    updateTrayAnchor(bounds);
  });

  // Cleanup on quit
  app.on('before-quit', async () => {
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
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.show();
    popupWindow.focus();
    return;
  }

  togglePopup();
});
