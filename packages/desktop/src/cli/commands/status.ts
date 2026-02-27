import { Command } from 'commander';
import { IpcClient } from '../ipc-client';
import type { DaemonStatus } from '@nomnomdrive/shared';

export function statusCommand(): Command {
  return new Command('status')
    .description('Show daemon and indexing status')
    .action(async () => {
      const client = new IpcClient();
      let res: Awaited<ReturnType<typeof client.send<DaemonStatus>>>;
      try {
        res = await client.send<DaemonStatus>({ command: 'status' });
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      if (!res.success) {
        console.error(`✗ ${res.error}`);
        process.exit(1);
      }

      const s = res.data!;
      console.log('\nNomNomDrive Status');
      console.log('──────────────────────────────');
      console.log(`  Model     : ${s.modelReady ? '● Ready' : '○ Loading…'}`);
      console.log(`  MCP       : http://localhost:${s.mcpPort}/mcp`);
      console.log(`  Queue     : ${s.queueLength ?? s.queueSize ?? 0} file(s) pending`);
      console.log(`  Indexing  : ${s.currentFile ?? 'idle'}`);

      const docCount = s.stats?.documentCount ?? s.indexedFiles ?? '?';
      const chunkCount = s.stats?.chunkCount ?? s.indexedChunks ?? '?';
      console.log('');
      console.log(`  Documents : ${docCount}`);
      console.log(`  Chunks    : ${chunkCount}`);

      const paths = s.folders?.map((f) => f.path) ?? s.watchedPaths ?? [];
      if (paths.length > 0) {
        console.log('\n  Watched folders:');
        for (const p of paths) {
          console.log(`    ● ${p}`);
        }
      }

      console.log('');
    });
}
