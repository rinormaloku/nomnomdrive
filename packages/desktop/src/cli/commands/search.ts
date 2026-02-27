import { Command } from 'commander';
import * as fs from 'fs';
import { loadConfig, getDbPath } from '../../main/config';
import { Store } from '../../main/store';
import { Embedder } from '../../main/embedder';

export function searchCommand(): Command {
  return new Command('search')
    .description('Semantic search over indexed documents')
    .argument('<query>', 'Search query')
    .option('-n, --limit <n>', 'Max results', '5')
    .option('--folder <path>', 'Filter by folder path')
    .option('--type <ext>', 'Filter by file extension (e.g. pdf)')
    .action(async (query: string, opts: { limit: string; folder?: string; type?: string }) => {
      const config = await loadConfig();
      const dbPath = getDbPath();

      if (!fs.existsSync(dbPath)) {
        console.error('No index found. Run `nomnomdrive init` and start the daemon first.');
        process.exit(1);
      }

      const store = new Store(config);
      await store.initialize();

      const embedder = new Embedder(config);
      await embedder.initialize();

      process.stdout.write('Searching…');

      const vec = await embedder.getEmbedding(query);
      const limit = Math.max(1, parseInt(opts.limit, 10) || 5);
      const results = await store.searchSimilar(vec, limit, {
        folder: opts.folder,
        fileType: opts.type,
      });

      process.stdout.write('\r              \r');

      if (results.length === 0) {
        console.log('No results found.');
      } else {
        console.log(`\nTop ${results.length} result(s) for: "${query}"\n`);
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const score = r.score !== undefined ? `  score: ${r.score.toFixed(3)}` : '';
          console.log(`${i + 1}. ${r.filename}${score}`);
          console.log(`   ${r.content.slice(0, 200).replace(/\n/g, ' ')}…\n`);
        }
      }

      await embedder.dispose();
      store.close();
    });
}
