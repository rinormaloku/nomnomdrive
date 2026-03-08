import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetDocumentSchema } from '@nomnomdrive/shared';
import type { Store } from '../../store';
import { executeGetDocument } from './handlers';

export function registerDocumentTool(server: McpServer, store: Store): void {
  server.tool(
    'get_document',
    'Retrieve the full text content of a specific indexed document by filename or path.',
    GetDocumentSchema.shape,
    (args) => executeGetDocument(store, args),
  );
}
