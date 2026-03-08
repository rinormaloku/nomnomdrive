import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SearchDocumentsSchema } from '@nomnomdrive/shared';
import type { Store } from '../../store';
import type { Embedder } from '../../embedder';
import { executeSearchDocuments } from './handlers';

export function registerSearchTool(server: McpServer, store: Store, embedder: Embedder): void {
  server.tool(
    'search_documents',
    "Search the user's locally indexed documents using semantic similarity. Returns the most relevant text chunks with source filenames.",
    SearchDocumentsSchema.shape,
    (args) => executeSearchDocuments(store, embedder, args),
  );
}
