import { Command } from 'commander';
import * as child_process from 'child_process';
import * as path from 'path';
import { IpcClient } from '../ipc-client';

export function startCommand(): Command {
  return new Command('start')
    .description('Start the NomNomDrive background daemon (Electron app)')
    .action(async () => {
      const client = new IpcClient();
      const already = await client.ping();
      if (already) {
        console.log('NomNomDrive is already running.');
        return;
      }

      // Try to locate the packaged Electron binary
      // During development: use electron directly via node_modules
      let electronBin: string;
      try {
        // packaged app: the electron binary is bundled
        const electronPath = require('electron') as string;
        electronBin = electronPath;
      } catch {
        console.error('Could not locate Electron binary. Install the desktop package or use the packaged app.');
        process.exit(1);
      }

      const mainEntry = path.resolve(__dirname, '../main/index.js');

      const child = child_process.spawn(electronBin, [mainEntry], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, NOMNOMDRIVE_HEADLESS: '1' },
      });
      child.unref();

      // Wait for daemon to become available
      process.stdout.write('Starting NomNomDrive');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        process.stdout.write('.');
        const ready = await client.ping();
        if (ready) {
          process.stdout.write('\n✓ NomNomDrive is running\n');
          return;
        }
      }
      process.stdout.write('\n');
      console.log('Daemon started but not yet responding. It may still be loading the model.');
    });
}
