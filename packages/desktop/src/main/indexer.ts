import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import fg from 'fast-glob';
import type { EventEmitter } from 'events';
import { type IndexingProgress } from '@nomnomdrive/shared';
import { isSupportedExtension, parseDocument } from './parser';
import { splitIntoChunks } from './chunker';
import type { Store } from './store';
import type { Embedder } from './embedder';
import { makeDocId, makeChunkId } from './store';

type IndexAction = 'upsert' | 'delete';

interface QueueItem {
  filePath: string;
  action: IndexAction;
}

export class Indexer {
  private readonly store: Store;
  private readonly embedder: Embedder;
  private queue: QueueItem[] = [];
  private processing = false;
  private emitter: EventEmitter | null = null;

  constructor(store: Store, embedder: Embedder) {
    this.store = store;
    this.embedder = embedder;
  }

  setEmitter(emitter: EventEmitter): void {
    this.emitter = emitter;
  }

  enqueue(filePath: string, action: IndexAction): void {
    // Deduplicate: if file already in queue, update action
    const existing = this.queue.findIndex((q) => q.filePath === filePath);
    if (existing >= 0) {
      this.queue[existing].action = action;
    } else {
      this.queue.push({ filePath, action });
    }
    this.processNext();
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  /** Initial scan of all configured paths on startup */
  async scanAll(watchPaths: string[]): Promise<void> {
    for (const watchPath of watchPaths) {
      const pattern = path.join(watchPath, '**/*').replace(/\\/g, '/');
      const files = await fg(pattern, {
        onlyFiles: true,
        followSymbolicLinks: false,
        ignore: ['**/node_modules/**', '**/.git/**'],
      });
      for (const file of files) {
        if (isSupportedExtension(file)) {
          this.enqueue(file, 'upsert');
        }
      }
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const item = this.queue.shift()!;
    try {
      if (item.action === 'upsert') {
        await this.indexFile(item.filePath);
      } else {
        await this.deleteFile(item.filePath);
      }
    } catch (err) {
      console.error(`[Indexer] Error processing ${item.filePath}:`, err);
      this.emitter?.emit('indexing:error', { filePath: item.filePath, error: String(err) });
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        setImmediate(() => this.processNext());
      }
    }
  }

  private async indexFile(filePath: string): Promise<void> {
    // 1. Resolve folder and relative path
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) return;

    const fileSize = stat.size;
    const fileType = path.extname(filePath).replace('.', '').toLowerCase();

    // 2. Find which folder this belongs to
    const folders = await this.store.listFolders();
    const folder = folders.find((f) => filePath.startsWith(f.path));
    if (!folder) {
      // Register folder on-the-fly for ad-hoc files
      const folderPath = path.dirname(filePath);
      await this.store.upsertFolder(folderPath);
      return this.indexFile(filePath); // retry
    }

    const relativePath = path.relative(folder.path, filePath);
    const docId = makeDocId(folder.folderId, relativePath);

    // 3. Content hash check — skip if unchanged
    const buffer = await fs.readFile(filePath);
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const existingHash = await this.store.getDocumentHash(docId);
    if (existingHash === contentHash) return; // unchanged

    // 4. Parse
    this.emitProgress({ filePath, phase: 'parsing', chunksProcessed: 0, chunksTotal: 0, queueLength: this.queue.length });
    const text = await parseDocument(filePath);
    if (!text.trim()) return;

    // 5. Chunk
    this.emitProgress({ filePath, phase: 'chunking', chunksProcessed: 0, chunksTotal: 0, queueLength: this.queue.length });
    const rawChunks = splitIntoChunks(text);

    // Prepend per-chunk metadata so the embedding captures document identity.
    // This lets the vector search associate content with its source file —
    // e.g. a chunk that's just a number becomes retrievable by file name.
    const fileName = path.basename(relativePath);
    const totalChunks = rawChunks.length;
    const chunks = rawChunks.map((c) => ({
      ...c,
      text: `<metadata>\nfile: ${relativePath}\nname: ${fileName}\ntype: ${fileType}\nchunk: ${c.index + 1} of ${totalChunks}\n</metadata>\n\n${c.text}`,
    }));

    // 6. Content-addressed chunk IDs: hash(text) → same text = same ID across docs.
    //    Check which chunks are already stored so we can skip re-embedding them.
    const chunkIds = chunks.map((c) => makeChunkId(c.text));
    const existingIds = this.store.getExistingChunkIds(chunkIds);
    const newChunkCount = chunkIds.filter((id) => !existingIds.has(id)).length;

    // 7. Embed only chunks whose text (and thus chunk_id) is new to the DB.
    //    Unchanged chunks that survived a document edit are reused as-is —
    //    no re-embedding, no churn in the vec_chunks index.
    const embeddedChunks: Array<{ chunkId: string; text: string; embedding: number[] | null }> = [];
    let embedded = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = chunkIds[i];
      if (existingIds.has(chunkId)) {
        embeddedChunks.push({ chunkId, text: chunks[i].text, embedding: null });
      } else {
        this.emitProgress({
          filePath,
          phase: 'embedding',
          chunksProcessed: embedded,
          chunksTotal: newChunkCount,
          queueLength: this.queue.length,
        });
        const embedding = await this.embedder.getEmbedding(chunks[i].text);
        embeddedChunks.push({ chunkId, text: chunks[i].text, embedding });
        embedded++;
      }
    }

    // 8. Store
    this.emitProgress({ filePath, phase: 'storing', chunksProcessed: chunks.length, chunksTotal: chunks.length, queueLength: this.queue.length });
    await this.store.upsertDocument({
      docId,
      folderId: folder.folderId,
      relativePath,
      contentHash,
      fileSize,
      fileType,
      chunks: embeddedChunks,
    });

    this.emitter?.emit('indexing:complete', { filePath, chunkCount: chunks.length });
  }

  private async deleteFile(filePath: string): Promise<void> {
    const folders = await this.store.listFolders();
    const folder = folders.find((f) => filePath.startsWith(f.path));
    if (!folder) return;

    const relativePath = path.relative(folder.path, filePath);
    const docId = makeDocId(folder.folderId, relativePath);
    await this.store.removeDocument(docId);
    this.emitter?.emit('indexing:deleted', { filePath });
  }

  private emitProgress(progress: IndexingProgress): void {
    this.emitter?.emit('indexing:progress', progress);
  }
}
