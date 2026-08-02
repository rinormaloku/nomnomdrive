import type { Store } from './store';
import type { IEmbedder } from './embedder';
import {
  executeSearchDocuments,
  executeListFolders,
  executeListFiles,
  executeGetDocument,
} from './mcp/tools/handlers';

/**
 * Single source of truth for the tools the chat agent can call.
 * Mirrors the MCP server's tools (search.tool.ts, folders.tool.ts,
 * files.tool.ts, document.tool.ts) — same names, descriptions, and
 * parameters — so the built-in agent is as capable as any MCP client.
 */
export type ChatToolDef = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (store: Store, embedder: IEmbedder, args: Record<string, unknown>) => Promise<string>;
};

function clampLimit(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(n, max));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export const CHAT_TOOLS: ChatToolDef[] = [
  {
    name: 'search_documents',
    description:
      "Search the user's locally indexed documents using semantic similarity. Returns the most relevant text chunks with source filenames.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        limit: { type: 'number', description: 'Max results to return (1-20, default 5)' },
        folder: { type: 'string', description: 'Filter to a specific folder path' },
        file_type: { type: 'string', description: 'Filter by file type: pdf, docx, md, txt, etc.' },
      },
      required: ['query'],
    },
    async execute(store, embedder, args) {
      const result = await executeSearchDocuments(store, embedder, {
        query: String(args.query ?? ''),
        limit: clampLimit(args.limit, 1, 20, 5),
        folder: optionalString(args.folder),
        file_type: optionalString(args.file_type),
      });
      return result.content[0].text;
    },
  },
  {
    name: 'list_folders',
    description:
      "List all indexed folders and their document counts. Use this to understand what's available before searching.",
    parameters: { type: 'object', properties: {} },
    async execute(store) {
      const result = await executeListFolders(store);
      return result.content[0].text;
    },
  },
  {
    name: 'list_files',
    description:
      'List indexed files with optional filtering by filename substring, folder, or file type.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'Substring to filter filenames (case-insensitive). Example: "report" matches "Q1-Report.pdf". Omit or pass "*" to list all files.',
        },
        folder: { type: 'string', description: 'Filter to files in a specific folder path' },
        file_type: { type: 'string', description: 'Filter by file type: pdf, docx, md, txt, etc.' },
        limit: { type: 'number', description: 'Max files to return (1-100, default 20)' },
      },
    },
    async execute(store, _embedder, args) {
      const result = await executeListFiles(store, {
        pattern: optionalString(args.pattern),
        folder: optionalString(args.folder),
        file_type: optionalString(args.file_type),
        limit: clampLimit(args.limit, 1, 100, 20),
      });
      return result.content[0].text;
    },
  },
  {
    name: 'get_document',
    description:
      'Retrieve the full text content of a specific indexed document by filename or path.',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Filename or relative path of the document to retrieve',
        },
      },
      required: ['filename'],
    },
    async execute(store, _embedder, args) {
      const result = await executeGetDocument(store, { filename: String(args.filename ?? '') });
      return result.content[0].text;
    },
  },
];
