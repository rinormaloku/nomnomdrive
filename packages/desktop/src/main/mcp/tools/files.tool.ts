import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Store } from '../../store';
import { ListFilesSchema } from '@nomnomdrive/shared';
import { executeListFiles } from './handlers';

export function registerFilesTool(server: McpServer, store: Store): void {
  server.tool(
    'list_files',
    'List indexed files with optional filtering by filename substring, folder, or file type.',
    ListFilesSchema.shape,
    (args) => executeListFiles(store, args),
  );
}
