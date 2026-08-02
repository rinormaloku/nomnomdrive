import { Command } from 'commander';
import * as fs from 'fs';
import { loadConfig, getDbPath } from '../../main/config';
import { Store } from '../../main/store';
import { Embedder } from '../../main/embedder';
import { compileFilter } from '../../main/doc-filter';

export function searchCommand(): Command {
  return new Command('search')
    .description('Hybrid (semantic + keyword) search over indexed documents')
    .argument('<query>', 'Search query')
    .option('-n, --limit <n>', 'Max results', '5')
    .option(
      '-f, --filter <pattern>',
      'Narrow to matching files — plain text or regex, matched against file and folder name',
    )
    .action(async (query: string, opts: { limit: string; filter?: string }) => {
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

      const vec = await embedder.embedQuery(query);
      const limit = Math.max(1, parseInt(opts.limit, 10) || 5);
      const results = await store.searchHybrid(
        vec,
        query,
        limit,
        opts.filter ? compileFilter(opts.filter) : undefined,
      );

      process.stdout.write('\r              \r');

      if (results.length === 0) {
        console.log('No results found.');
      } else {
        console.log(`\nTop ${results.length} result(s) for: "${query}"\n`);
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const score = r.score > 0 ? `  score: ${r.score.toFixed(3)}` : '  (keyword match)';
          console.log(`${i + 1}. ${r.filename}  chunk ${r.chunkIndex}/${r.totalChunks}${score}`);
          console.log(`   ${r.content.slice(0, 200).replace(/\n/g, ' ')}…\n`);
        }
      }

      await embedder.dispose();
      store.close();
    });
}
