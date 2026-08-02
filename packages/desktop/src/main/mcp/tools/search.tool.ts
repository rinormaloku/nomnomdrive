import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SearchDocumentsSchema } from '@nomnomdrive/shared';
import type { Store } from '../../store';
import type { IEmbedder } from '../../embedder';
import { executeSearchDocuments } from './handlers';

export const SEARCH_TOOL_DESCRIPTION =
  "Search the user's indexed documents by meaning and by exact keyword at once. " +
  'Start here for any question about what a document says. Returns passages — a few ' +
  'consecutive chunks of one file — each labelled with its file name and chunk range, ' +
  'so you can pull more context around a hit with read_document.';

export function registerSearchTool(server: McpServer, store: Store, embedder: IEmbedder): void {
  server.tool(
    'search_documents',
    SEARCH_TOOL_DESCRIPTION,
    SearchDocumentsSchema.shape,
    (args) => executeSearchDocuments(store, embedder, args),
  );
}
