import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Store } from '../../store';
import { executeListFolders } from './handlers';

export function registerFoldersTool(server: McpServer, store: Store): void {
  server.tool(
    'list_folders',
    "List all indexed folders and their document counts. Use this to understand what's available before searching.",
    {},
    () => executeListFolders(store),
  );
}
