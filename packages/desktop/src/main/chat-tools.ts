import type { Store } from './store';
import type { IEmbedder } from './embedder';
import {
  executeSearchDocuments,
  executeListFiles,
  executeReadDocument,
} from './mcp/tools/handlers';
import { SEARCH_TOOL_DESCRIPTION } from './mcp/tools/search.tool';
import { LIST_FILES_TOOL_DESCRIPTION } from './mcp/tools/files.tool';
import { READ_DOCUMENT_TOOL_DESCRIPTION } from './mcp/tools/read.tool';

/**
 * Single source of truth for the tools the chat agent can call.
 * Mirrors the MCP server's tools (search.tool.ts, files.tool.ts, read.tool.ts)
 * — same names, descriptions, and parameters — so the built-in agent is as
 * capable as any MCP client.
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

const FILTER_PARAM = {
  type: 'string',
  description:
    'Narrow to matching documents. Plain text matches a file name substring ("invoice"); ' +
    'regex is supported ("\\.pdf$"). Also matches the folder name. Omit for everything.',
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalChunkNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.floor(value));
}

export const CHAT_TOOLS: ChatToolDef[] = [
  {
    name: 'search_documents',
    description: SEARCH_TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in natural language.' },
        filter: FILTER_PARAM,
      },
      required: ['query'],
    },
    async execute(store, embedder, args) {
      const result = await executeSearchDocuments(store, embedder, {
        query: String(args.query ?? ''),
        filter: optionalString(args.filter),
      });
      return result.content[0].text;
    },
  },
  {
    name: 'list_files',
    description: LIST_FILES_TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: { filter: FILTER_PARAM },
    },
    async execute(store, _embedder, args) {
      const result = await executeListFiles(store, { filter: optionalString(args.filter) });
      return result.content[0].text;
    },
  },
  {
    name: 'read_document',
    description: READ_DOCUMENT_TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File name, exactly as shown by search_documents or list_files.',
        },
        from: { type: 'number', description: 'First chunk to read (1-based).' },
        to: { type: 'number', description: 'Last chunk to read, inclusive.' },
      },
      required: ['file'],
    },
    async execute(store, _embedder, args) {
      const result = await executeReadDocument(store, {
        file: String(args.file ?? ''),
        from: optionalChunkNumber(args.from),
        to: optionalChunkNumber(args.to),
      });
      return result.content[0].text;
    },
  },
];
