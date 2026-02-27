import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import { confirm, input, select } from '@inquirer/prompts';
import {
  loadConfig,
  saveConfig,
  getDefaultDropFolder,
  type AppConfig,
} from '../../main/config';
import { Store } from '../../main/store';
import { DEFAULT_EMBED_MODEL, DEFAULT_MCP_PORT } from '@nomnomdrive/shared';

export function initCommand(): Command {
  return new Command('init')
    .description('Interactive setup: configure folders, download model, register MCP clients')
    .action(async () => {
      console.log('\n🤖 Welcome to NomNomDrive!\n');
      console.log('This wizard will:');
      console.log('  · Set up your watch folder');
      console.log('  · Download the embedding model (~300 MB)');
      console.log('  · Register NomNomDrive as an MCP server in Claude Desktop / Cursor\n');

      // ── Load existing config ──────────────────────────────────────────
      let config: AppConfig = await loadConfig();

      // ── Drop folder ───────────────────────────────────────────────────
      const defaultDrop =
        config.watch.paths[0] ?? getDefaultDropFolder();
      const dropFolder = await input({
        message: 'Watch folder path:',
        default: defaultDrop,
      });

      const expandedDrop = dropFolder.replace(/^~/, os.homedir());
      if (!fs.existsSync(expandedDrop)) {
        fs.mkdirSync(expandedDrop, { recursive: true });
        console.log(`  Created ${expandedDrop}`);
      }

      // ── Model ─────────────────────────────────────────────────────────
      const modelChoice = await select({
        message: 'Embedding model:',
        choices: [
          {
            name: 'embeddinggemma-300M (recommended, ~300 MB)',
            value: DEFAULT_EMBED_MODEL,
          },
          { name: 'Enter custom HuggingFace model path', value: '__custom__' },
        ],
      });

      let modelId = modelChoice;
      if (modelId === '__custom__') {
        modelId = await input({ message: 'Custom model (hf:<org>/<repo> or absolute path):' });
      }

      // ── MCP port ──────────────────────────────────────────────────────
      const mcpPortStr = await input({
        message: 'MCP server port:',
        default: String(config.mcp.port ?? DEFAULT_MCP_PORT),
      });
      const mcpPort = parseInt(mcpPortStr, 10) || DEFAULT_MCP_PORT;

      // ── Save config ───────────────────────────────────────────────────
      const newPaths = [...new Set([...(config.watch.paths ?? []), expandedDrop])];
      config = {
        ...config,
        watch: { ...config.watch, paths: newPaths },
        model: { localEmbed: modelId },
        mcp: { port: mcpPort },
      };
      await saveConfig(config);
      console.log('\n✓ Config saved');

      // ── Initialize DB ─────────────────────────────────────────────────
      console.log('Initializing database…');
      const store = new Store(config);
      await store.initialize();
      for (const p of config.watch.paths) {
        await store.upsertFolder(p);
      }
      store.close();
      console.log('✓ Database ready');

      // ── Download model ────────────────────────────────────────────────
      console.log(`\nDownloading model: ${modelId}`);
      console.log('(This may take a few minutes on first run)\n');

      // Use Embedder to resolve/download the model
      const { Embedder } = await import('../../main/embedder');
      const embedder = new Embedder(config);
      let lastPct = -1;
      await embedder.initialize((downloaded: number, total: number) => {
        if (total > 0) {
          const pct = Math.floor((downloaded / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            process.stdout.write(`\r  Downloading… ${pct}%`);
            lastPct = pct;
          }
        }
      });
      await embedder.dispose();
      process.stdout.write('\r  Downloaded            \n');
      console.log('✓ Model ready');

      // ── Register MCP clients ──────────────────────────────────────────
      const shouldRegister = await confirm({
        message: 'Register MCP server with Claude Desktop / Cursor?',
        default: true,
      });

      if (shouldRegister) {
        const { registerMcpClients } = await import('../../main/mcp-register');
        const results = await registerMcpClients(mcpPort);
        for (const r of results) {
          if (r.registered) {
            console.log(`✓ Registered with ${r.client}`);
          } else {
            console.log(`  Skipped ${r.client}: config not found at ${r.configPath}`);
          }
        }
      }

      // ── Summary ───────────────────────────────────────────────────────
      console.log('\n─────────────────────────────────────────');
      console.log('NomNomDrive is set up!');
      console.log('');
      console.log(`  Watch folder : ${expandedDrop}`);
      console.log(`  MCP endpoint : http://localhost:${mcpPort}/mcp`);
      console.log('');
      console.log('Start the background daemon:');
      console.log('  nomnomdrive start');
      console.log('');
      console.log('Or launch the desktop app from your Applications menu.');
      console.log('─────────────────────────────────────────\n');
    });
}
