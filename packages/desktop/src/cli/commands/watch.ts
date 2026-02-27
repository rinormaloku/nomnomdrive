import { Command } from 'commander';
import { IpcClient } from '../ipc-client';

export function watchCommand(): Command {
  const cmd = new Command('watch').description('Manage watched folders');

  cmd
    .command('add <path>')
    .description('Add a folder to watch')
    .action(async (folderPath: string) => {
      const client = new IpcClient();
      const res = await client.send<{ path: string }>({ command: 'watch.add', payload: { path: folderPath } });
      if (res.success) {
        console.log(`✓ Now watching: ${res.data?.path ?? folderPath}`);
      } else {
        console.error(`✗ ${res.error}`);
        process.exit(1);
      }
    });

  cmd
    .command('remove <path>')
    .description('Remove a folder from watch list')
    .action(async (folderPath: string) => {
      const client = new IpcClient();
      const res = await client.send<{ path: string }>({ command: 'watch.remove', payload: { path: folderPath } });
      if (res.success) {
        console.log(`✓ Removed: ${folderPath}`);
      } else {
        console.error(`✗ ${res.error}`);
        process.exit(1);
      }
    });

  cmd
    .command('list')
    .description('List watched folders')
    .action(async () => {
      const client = new IpcClient();
      const res = await client.send<Array<{ path: string; docCount: number; chunkCount: number }>>({
        command: 'watch.list',
      });
      if (!res.success) {
        console.error(`✗ ${res.error}`);
        process.exit(1);
      }
      const folders = res.data ?? [];
      if (folders.length === 0) {
        console.log('No folders being watched.');
        return;
      }
      console.log('Watched folders:');
      for (const f of folders) {
        console.log(`  ● ${f.path}  (${f.docCount ?? 0} docs, ${f.chunkCount ?? 0} chunks)`);
      }
    });

  return cmd;
}
