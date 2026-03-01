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
import { DEFAULT_EMBED_MODEL, DEFAULT_CHAT_MODEL, DEFAULT_MCP_PORT } from '@nomnomdrive/shared';

export function initCommand(): Command {
  return new Command('init')
    .description('Interactive setup: configure folders, download model, register MCP clients')
    .action(async () => {
      console.log('\n🤖 Welcome to NomNomDrive!\n');
      console.log('This wizard will:');
      console.log('  · Set up your watch folder');
      console.log('  · Download the embedding model');
      console.log('  · Optionally download a chat model for local Q&A');
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

      // ── Embedding model ──────────────────────────────────────────────
      const embedChoice = await select({
        message: 'Embedding model:',
        choices: [
          {
            name: 'Qwen3-Embedding-0.6B (recommended, ~600 MB)',
            value: DEFAULT_EMBED_MODEL,
          },
          {
            name: 'embeddinggemma-300M (~300 MB)',
            value: 'hf:unsloth/embeddinggemma-300m-GGUF',
          },
          { name: 'Enter custom HuggingFace model path', value: '__custom__' },
        ],
      });

      let modelId = embedChoice;
      if (modelId === '__custom__') {
        modelId = await input({ message: 'Custom model (hf:<org>/<repo> or absolute path):' });
      }

      // ── Chat model ─────────────────────────────────────────────────
      const chatChoice = await select({
        message: 'Chat model (for local Q&A with your docs):',
        choices: [
          {
            name: 'Qwen3-1.7B (recommended, ~1.2 GB)',
            value: 'hf:unsloth/Qwen3-1.7B-GGUF',
          },
          {
            name: 'Qwen3-0.6B (~500 MB, faster but less capable)',
            value: DEFAULT_CHAT_MODEL,
          },
          {
            name: 'Qwen3-4B (~2.5 GB, best quality)',
            value: 'hf:unsloth/Qwen3-4B-GGUF',
          },
          { name: 'Enter custom HuggingFace model path', value: '__custom__' },
          { name: 'Skip — I only need MCP, no local chat', value: '__skip__' },
        ],
      });

      let chatModelId = chatChoice;
      if (chatModelId === '__custom__') {
        chatModelId = await input({ message: 'Custom chat model (hf:<org>/<repo> or absolute path):' });
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
        model: { localEmbed: modelId, localChat: chatModelId === '__skip__' ? '' : chatModelId },
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
      // Keep store open — we'll write embed_dims after the model loads
      console.log('✓ Database ready');

      // ── Download embedding model ─────────────────────────────────────
      console.log(`\nDownloading embedding model: ${modelId}`);
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

      // Write the actual embedding dims so the daemon can detect model changes later
      const storedDims = store.getStoredDims();
      const actualDims = embedder.getDims();
      if (storedDims !== actualDims) {
        store.resetForNewDims(actualDims);
      }
      store.close();

      await embedder.dispose();
      process.stdout.write('\r  Downloaded            \n');
      console.log('✓ Embedding model ready');

      // ── Download chat model ─────────────────────────────────────────
      if (chatModelId !== '__skip__') {
        console.log(`\nDownloading chat model: ${chatModelId}`);
        console.log('(This may take a few minutes on first run)\n');

        const { resolveModelPath } = await import('../../main/models');
        let chatLastPct = -1;
        await resolveModelPath(chatModelId, (downloaded: number, total: number) => {
          if (total > 0) {
            const pct = Math.floor((downloaded / total) * 100);
            if (pct !== chatLastPct && pct % 5 === 0) {
              process.stdout.write(`\r  Downloading… ${pct}%`);
              chatLastPct = pct;
            }
          }
        });
        process.stdout.write('\r  Downloaded            \n');
        console.log('✓ Chat model ready');
      } else {
        console.log('\n  Skipped chat model — you can add one later in config.yaml');
      }

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
      console.log(`  Embed model  : ${modelId}`);
      console.log(`  Chat model   : ${chatModelId === '__skip__' ? '(none)' : chatModelId}`);
      console.log(`  MCP endpoint : http://localhost:${mcpPort}/mcp`);
      console.log('');
      console.log('Start the background daemon:');
      console.log('  nomnomdrive start');
      console.log('');
      console.log('Or launch the desktop app from your Applications menu.');
      console.log('─────────────────────────────────────────\n');
    });
}
