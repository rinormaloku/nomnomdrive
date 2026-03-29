import type { Store } from '../../store';
import type { IEmbedder } from '../../embedder';
import type { SearchDocumentsInput, GetDocumentInput, ListFilesInput } from '@nomnomdrive/shared';
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

export async function executeListFiles(
  store: Store,
  args: ListFilesInput,
): Promise<McpToolResult> {
  const allDocs = await store.getAllDocuments();
  const folders = await store.listFolders();
  const folderPathMap = new Map(folders.map((f) => [f.folderId, f.path]));

  let filtered = allDocs;

  // Filter by folder (skip empty strings)
  if (args.folder && args.folder.trim()) {
    const folderLower = args.folder.trim().toLowerCase();
    filtered = filtered.filter((d) => {
      const folderPath = folderPathMap.get(d.folderId);
      return folderPath?.toLowerCase().includes(folderLower);
    });
  }

  // Filter by file type (skip empty strings)
  if (args.file_type && args.file_type.trim()) {
    const ft = args.file_type.trim().toLowerCase();
    filtered = filtered.filter((d) => d.fileType.toLowerCase() === ft);
  }

  // Filter by pattern (case-insensitive substring match).
  // Treat "*" or empty string as "match all" since models often pass "*" as a wildcard.
  if (args.pattern && args.pattern.trim() && args.pattern.trim() !== '*') {
    const pat = args.pattern.trim().toLowerCase();
    filtered = filtered.filter((d) => d.relativePath.toLowerCase().includes(pat));
  }

  // Limit
  const limit = args.limit ?? 20;
  const capped = filtered.slice(0, limit);

  if (capped.length === 0) {
    return { content: [{ type: 'text', text: 'No files found matching the criteria.' }] };
  }

  const lines = capped.map((d) => {
    const folderPath = folderPathMap.get(d.folderId) ?? '';
    const size = d.fileSize < 1024 ? `${d.fileSize} B`
      : d.fileSize < 1024 * 1024 ? `${(d.fileSize / 1024).toFixed(1)} KB`
      : `${(d.fileSize / (1024 * 1024)).toFixed(1)} MB`;
    return `${d.relativePath}  (${d.fileType}, ${size}, ${d.chunkCount} chunks)  in ${folderPath}`;
  });

  const header = filtered.length > limit
    ? `Showing ${limit} of ${filtered.length} files:\n`
    : `${filtered.length} file(s):\n`;

  return { content: [{ type: 'text', text: header + lines.join('\n') }] };
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
