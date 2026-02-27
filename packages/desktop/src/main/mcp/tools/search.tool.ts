import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SearchDocumentsSchema } from '@nomnomdrive/shared';
import type { Store } from '../../store';
import type { Embedder } from '../../embedder';

export function registerSearchTool(server: McpServer, store: Store, embedder: Embedder): void {
  server.tool(
    'search_documents',
    "Search the user's locally indexed documents using semantic similarity. Returns the most relevant text chunks with source filenames.",
    SearchDocumentsSchema.shape,
    async ({ query, limit = 5, folder, file_type }) => {
      if (!embedder.isReady()) {
        return {
          content: [{ type: 'text' as const, text: 'Embedding model is still loading. Please try again shortly.' }],
        };
      }

      const queryVector = await embedder.getEmbedding(query);
      const results = await store.searchSimilar(queryVector, limit, {
        folder,
        fileType: file_type,
      });

      if (results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No relevant documents found.' }],
        };
      }

      const formatted = results
        .map(
          (r, i) =>
            `[${i + 1}] ${r.filename} (${r.fileType}, score: ${r.score.toFixed(3)})\n${r.content}`,
        )
        .join('\n\n---\n\n');

      return { content: [{ type: 'text' as const, text: formatted }] };
    },
  );
}
