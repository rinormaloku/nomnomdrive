import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ReadDocumentSchema } from '@nomnomdrive/shared';
import type { Store } from '../../store';
import { executeReadDocument } from './handlers';

export const READ_DOCUMENT_TOOL_DESCRIPTION =
  'Read a document by chunk range. Chunk numbers come from search_documents — search ' +
  'first to find where the answer is, then read around it. Out-of-range values are ' +
  'clamped, not rejected. Omitting the range returns a short document in full; a long ' +
  'one returns a preview instead of flooding your context, with the chunk range to ask for.';

export function registerReadTool(server: McpServer, store: Store): void {
  server.tool(
    'read_document',
    READ_DOCUMENT_TOOL_DESCRIPTION,
    ReadDocumentSchema.shape,
    (args) => executeReadDocument(store, args),
  );
}
