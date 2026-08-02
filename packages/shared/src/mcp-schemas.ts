import { z } from 'zod';

/**
 * Three tools, five parameters. Every identifier a tool accepts (`file`) is one
 * the caller has seen in a previous tool's output, and `filter` means the same
 * thing everywhere: a pattern narrowing which documents are in play.
 */

/** Shared by search_documents and list_files — same syntax, same semantics. */
const filterParam = z
  .string()
  .optional()
  .describe(
    'Narrow to matching documents. Plain text matches a file name substring ' +
      '("invoice"); regex is supported for anything more ("\\.pdf$", "2024|2025"). ' +
      'Also matches the containing folder name, so "Work" limits the search to ' +
      'that folder. Omit to search everything.',
  );

export const SearchDocumentsSchema = z.object({
  query: z
    .string()
    .describe('What to look for, in natural language. Combined semantic and keyword search.'),
  filter: filterParam,
});
export type SearchDocumentsInput = z.infer<typeof SearchDocumentsSchema>;

export const ListFilesSchema = z.object({
  filter: filterParam,
});
export type ListFilesInput = z.infer<typeof ListFilesSchema>;

export const ReadDocumentSchema = z.object({
  file: z.string().describe('File name, exactly as shown in search_documents or list_files output.'),
  from: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('First chunk to read (1-based). Chunk numbers come from search_documents.'),
  to: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Last chunk to read, inclusive. Out-of-range values are clamped, never rejected.'),
});
export type ReadDocumentInput = z.infer<typeof ReadDocumentSchema>;
