import net from 'net';
import fs from 'fs/promises';
import type { IpcMessage, IpcResponse } from '@nomnomdrive/shared';
import type { AppConfig } from './config';
import { getDaemonSockPath, addWatchPath, removeWatchPath, saveConfig } from './config';
import type { Store } from './store';
import type { Watcher } from './watcher';
import type { Indexer } from './indexer';

export class IpcServer {
  private server: net.Server | null = null;
  private readonly config: AppConfig;
  private readonly store: Store;
  private readonly watcher: Watcher;
  private readonly indexer: Indexer;

  constructor(config: AppConfig, store: Store, watcher: Watcher, indexer: Indexer) {
    this.config = config;
    this.store = store;
    this.watcher = watcher;
    this.indexer = indexer;
  }

  async start(): Promise<void> {
    const sockPath = getDaemonSockPath();

    // Remove stale socket
    await fs.unlink(sockPath).catch(() => {});

    this.server = net.createServer((socket) => {
      let buffer = '';

      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as IpcMessage;
            this.handleMessage(msg).then((response) => {
              socket.write(JSON.stringify(response) + '\n');
            });
          } catch {
            socket.write(
              JSON.stringify({ id: 'unknown', success: false, error: 'Invalid JSON' } satisfies IpcResponse) + '\n',
            );
          }
        }
      });

      socket.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
          console.error('[IpcServer] Socket error:', err);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(sockPath, resolve);
      this.server!.once('error', reject);
    });
  }

  private async handleMessage(msg: IpcMessage): Promise<IpcResponse> {
    const id = msg.id ?? 'unknown';
    try {
      switch (msg.command) {
        case 'status': {
          const stats = await this.store.getStats();
          return {
            id,
            success: true,
            data: {
              pid: process.pid,
              running: true,
              indexedFiles: stats.fileCount,
              indexedChunks: stats.chunkCount,
              queueLength: this.indexer.getQueueLength(),
              model: this.config.model.localEmbed,
              mode: this.config.mode,
              mcpPort: this.config.mcp.port,
              watchedPaths: this.config.watch.paths,
            },
          };
        }

        case 'watch.list': {
          const folders = await this.store.listFolders();
          return { id, success: true, data: folders };
        }

        case 'watch.add': {
          const { path: folderPath } = msg.payload as { path: string };
          await addWatchPath(folderPath);
          await this.store.upsertFolder(folderPath);
          this.watcher.addPath(folderPath);
          await this.indexer.scanAll([folderPath]);
          return { id, success: true, data: { added: folderPath } };
        }

        case 'watch.remove': {
          const { path: folderPath } = msg.payload as { path: string };
          await removeWatchPath(folderPath);
          await this.store.removeFolder(folderPath);
          this.watcher.removePath(folderPath);
          return { id, success: true, data: { removed: folderPath } };
        }

        case 'reindex': {
          const staleDocs = await this.store.reconcileWithFilesystem();
          if (staleDocs > 0) console.log(`[Store] Reindex reconciliation removed ${staleDocs} stale record(s)`);
          const { path: folderPath } = (msg.payload ?? {}) as { path?: string };
          const paths = folderPath ? [folderPath] : this.config.watch.paths;
          await this.indexer.scanAll(paths);
          return { id, success: true, data: { queued: paths } };
        }

        case 'shutdown': {
          setImmediate(() => process.exit(0));
          return { id, success: true, data: null };
        }

        default:
          return { id, success: false, error: `Unknown command: ${msg.command}` };
      }
    } catch (err) {
      return { id, success: false, error: String(err) };
    }
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    await fs.unlink(getDaemonSockPath()).catch(() => {});
  }
}
