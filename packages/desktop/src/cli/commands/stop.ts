import { Command } from 'commander';
import { IpcClient } from '../ipc-client';

export function stopCommand(): Command {
  return new Command('stop')
    .description('Stop the NomNomDrive background daemon')
    .action(async () => {
      const client = new IpcClient();
      try {
        const res = await client.send({ command: 'shutdown' });
        if (res.success) {
          console.log('✓ NomNomDrive stopped');
        } else {
          console.error(`✗ ${res.error}`);
          process.exit(1);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
