#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { watchCommand } from './commands/watch';
import { searchCommand } from './commands/search';
import { statusCommand } from './commands/status';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';

const program = new Command();

program
  .name('nomnomdrive')
  .description('Local document indexing and MCP server for AI assistants')
  .version('0.1.0');

program.addCommand(initCommand());
program.addCommand(watchCommand());
program.addCommand(searchCommand());
program.addCommand(statusCommand());
program.addCommand(startCommand());
program.addCommand(stopCommand());

program.parseAsync(process.argv).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
