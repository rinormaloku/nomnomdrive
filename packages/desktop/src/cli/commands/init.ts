import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import { confirm, input, select } from '@inquirer/prompts';
import {
  loadConfig,
  getDefaultDropFolder,
  type AppConfig,
  EMBED_MODELS,
  CHAT_MODELS,
  MODEL_CUSTOM,
  MODEL_SKIP,
  runSetup,
  type SetupProgress,
  DEFAULT_MCP_PORT,
  registerMcpClients,
} from '@nomnomdrive/shared';

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
      const config: AppConfig = await loadConfig();

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

      // ── Embedding model (from shared catalog) ────────────────────────
      const embedChoices = [
        ...EMBED_MODELS.map((m) => ({
          name: `${m.label} (${m.size})${m.recommended ? ' ← recommended' : ''}`,
          value: m.id,
        })),
        { name: 'Enter custom HuggingFace model path', value: MODEL_CUSTOM },
      ];

      const embedChoice = await select({
        message: 'Embedding model:',
        choices: embedChoices,
      });

      let embedModelId = embedChoice;
      if (embedModelId === MODEL_CUSTOM) {
        embedModelId = await input({ message: 'Custom model (hf:<org>/<repo> or absolute path):' });
      }

      // ── Chat model (from shared catalog) ─────────────────────────────
      const chatChoices = [
        ...CHAT_MODELS.map((m) => ({
          name: `${m.label} (${m.size})${m.recommended ? ' ← recommended' : ''}`,
          value: m.id,
        })),
        { name: 'Enter custom HuggingFace model path', value: MODEL_CUSTOM },
        { name: 'Skip — I only need MCP, no local chat', value: MODEL_SKIP },
      ];

      const chatChoice = await select({
        message: 'Chat model (for local Q&A with your docs):',
        choices: chatChoices,
      });

      let chatModelId = chatChoice;
      if (chatModelId === MODEL_CUSTOM) {
        chatModelId = await input({ message: 'Custom chat model (hf:<org>/<repo> or absolute path):' });
      }

      // ── MCP port ──────────────────────────────────────────────────────
      const mcpPortStr = await input({
        message: 'MCP server port:',
        default: String(config.mcp.port ?? DEFAULT_MCP_PORT),
      });
      const mcpPort = parseInt(mcpPortStr, 10) || DEFAULT_MCP_PORT;

      // ── Run shared setup engine ───────────────────────────────────────
      console.log('\n✓ Config saved');
      console.log('Downloading models (this may take a few minutes on first run)\n');

      let lastPct = -1;
      const savedConfig = await runSetup(
        { watchPath: expandedDrop, embedModelId, chatModelId, mcpPort },
        (progress: SetupProgress) => {
          if (progress.total > 0) {
            const pct = Math.floor((progress.downloaded / progress.total) * 100);
            if (pct !== lastPct && pct % 5 === 0) {
              process.stdout.write(`\r  Downloading ${progress.modelLabel}… ${pct}%`);
              lastPct = pct;
            }
          }
        },
        (phase, _modelId) => {
          lastPct = -1;
          if (phase === 'chat') {
            process.stdout.write('\r  Downloaded            \n');
            console.log('✓ Embedding model ready\n');
          }
        },
      );
      process.stdout.write('\r  Downloaded            \n');
      console.log(chatModelId === MODEL_SKIP
        ? '  Skipped chat model — you can add one later in config.yaml'
        : '✓ Chat model ready');

      // ── Initialize DB ─────────────────────────────────────────────────
      console.log('\nInitializing database…');
      const { Embedder } = await import('../../main/embedder');
      const { Store } = await import('../../main/store');
      const store = new Store(savedConfig);
      await store.initialize();
      for (const p of savedConfig.watch.paths) {
        await store.upsertFolder(p);
      }

      // Validate embedding dims
      const embedder = new Embedder(savedConfig);
      await embedder.initialize();
      const storedDims = store.getStoredDims();
      const actualDims = embedder.getDims();
      if (storedDims !== actualDims) {
        store.resetForNewDims(actualDims);
      }
      store.close();
      await embedder.dispose();
      console.log('✓ Database ready');

      // ── Register MCP clients ──────────────────────────────────────────
      const shouldRegister = await confirm({
        message: 'Register MCP server with Claude Desktop / Cursor?',
        default: true,
      });

      if (shouldRegister) {
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
      console.log(`  Embed model  : ${embedModelId}`);
      console.log(`  Chat model   : ${chatModelId === MODEL_SKIP ? '(none)' : chatModelId}`);
      console.log(`  MCP endpoint : http://localhost:${mcpPort}/mcp`);
      console.log('');
      console.log('Start the background daemon:');
      console.log('  nomnomdrive start');
      console.log('');
      console.log('Or launch the desktop app from your Applications menu.');
      console.log('─────────────────────────────────────────\n');
    });
}
