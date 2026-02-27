import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetDocumentSchema } from '@nomnomdrive/shared';
import type { Store } from '../../store';

export function registerDocumentTool(server: McpServer, store: Store): void {
  server.tool(
    'get_document',
    'Retrieve the full text content of a specific indexed document by filename or path.',
    GetDocumentSchema.shape,
    async ({ filename }) => {
      const text = await store.getDocumentText(filename);

      if (!text) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Document not found: "${filename}". Use list_folders to browse available documents.`,
            },
          ],
        };
      }

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
