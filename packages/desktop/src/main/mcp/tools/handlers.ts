import type { Store } from '../../store';
import type { IEmbedder } from '../../embedder';
import type { SearchDocumentsInput, GetDocumentInput } from '@nomnomdrive/shared';
import type { McpTextContent } from '@nomnomdrive/shared';

export type McpToolResult = { content: McpTextContent[] };

export async function executeSearchDocuments(
  store: Store,
  embedder: IEmbedder,
  args: SearchDocumentsInput,
): Promise<McpToolResult> {
  if (!embedder.isReady()) {
    return {
      content: [{ type: 'text', text: 'Embedding model is still loading. Please try again shortly.' }],
    };
  }

  const queryVector = await embedder.getEmbedding(args.query);
  const results = await store.searchSimilar(queryVector, args.limit ?? 5, {
    folder: args.folder,
    fileType: args.file_type,
  });

  if (results.length === 0) {
    return { content: [{ type: 'text', text: 'No relevant documents found.' }] };
  }

  const formatted = results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.filename} (${r.fileType}, score: ${r.score.toFixed(3)})\n${r.content}`,
    )
    .join('\n\n---\n\n');

  return { content: [{ type: 'text', text: formatted }] };
}

export async function executeListFolders(store: Store): Promise<McpToolResult> {
  const folders = await store.listFolders();

  if (folders.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No folders indexed yet. Run `nomnomdrive init` to set up a drop folder.',
        },
      ],
    };
  }

  const lines = folders.map(
    (f) => `• ${f.path}  (${f.docCount} files, ${f.chunkCount} chunks)`,
  );

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export async function executeGetDocument(
  store: Store,
  args: GetDocumentInput,
): Promise<McpToolResult> {
  const text = await store.getDocumentText(args.filename);

  if (!text) {
    return {
      content: [
        {
          type: 'text',
          text: `Document not found: "${args.filename}". Use list_folders to browse available documents.`,
        },
      ],
    };
  }

  return { content: [{ type: 'text', text }] };
}
