import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import { type AppConfig } from './config';
import { isSupportedExtension } from './parser';
import type { Indexer } from './indexer';

export class Watcher {
  private watcher: FSWatcher | null = null;
  private readonly config: AppConfig;
  private readonly indexer: Indexer;

  constructor(config: AppConfig, indexer: Indexer) {
    this.config = config;
    this.indexer = indexer;
  }

  async start(): Promise<void> {
    const paths = this.config.watch.paths;
    if (paths.length === 0) return;

    this.watcher = chokidar.watch(paths, {
      ignored: [
        /(^|[/\\])\../, // dotfiles
        /node_modules/,
        /\.db$/,
        /\.db-shm$/,
        /\.db-wal$/,
      ],
      persistent: true,
      ignoreInitial: true, // initial scan handled by Indexer.scanAll()
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (filePath) => {
      if (isSupportedExtension(filePath)) {
        this.indexer.enqueue(filePath, 'upsert');
      }
    });

    this.watcher.on('change', (filePath) => {
      if (isSupportedExtension(filePath)) {
        this.indexer.enqueue(filePath, 'upsert');
      }
    });

    this.watcher.on('unlink', (filePath) => {
      if (isSupportedExtension(filePath)) {
        this.indexer.enqueue(filePath, 'delete');
      }
    });

    this.watcher.on('error', (err) => {
      console.error('[Watcher] Error:', err);
    });
  }

  addPath(folderPath: string): void {
    this.watcher?.add(folderPath);
  }

  removePath(folderPath: string): void {
    this.watcher?.unwatch(folderPath);
  }

  getWatchedPaths(): string[] {
    if (!this.watcher) return [];
    const watched = this.watcher.getWatched();
    return Object.keys(watched).filter((p) => watched[p].length > 0 || path.extname(p) === '');
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}
