import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Store } from '../../store';

export function registerFoldersTool(server: McpServer, store: Store): void {
  server.tool(
    'list_folders',
    "List all indexed folders and their document counts. Use this to understand what's available before searching.",
    {},
    async () => {
      const folders = await store.listFolders();

      if (folders.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No folders indexed yet. Run `nomnomdrive init` to set up a drop folder.',
            },
          ],
        };
      }

      const lines = folders.map(
        (f) => `• ${f.path}  (${f.docCount} files, ${f.chunkCount} chunks)`,
      );

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );
}
