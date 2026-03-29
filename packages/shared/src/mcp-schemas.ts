import { z } from 'zod';

export const SearchDocumentsSchema = z.object({
  query: z.string().describe('Natural language search query'),
  limit: z.number().int().min(1).max(20).default(5).describe('Max results to return'),
  folder: z.string().optional().describe('Filter to a specific folder path'),
  file_type: z
    .string()
    .optional()
    .describe('Filter by file type: pdf, docx, md, txt, etc.'),
});
export type SearchDocumentsInput = z.infer<typeof SearchDocumentsSchema>;

export const ListFoldersSchema = z.object({});
export type ListFoldersInput = z.infer<typeof ListFoldersSchema>;

export const ListFilesSchema = z.object({
  pattern: z
    .string()
    .optional()
    .describe('Grep-like pattern to filter filenames (case-insensitive substring match). Omit to list all files.'),
  folder: z
    .string()
    .optional()
    .describe('Filter to files in a specific folder path'),
  file_type: z
    .string()
    .optional()
    .describe('Filter by file type: pdf, docx, md, txt, etc.'),
  limit: z.number().int().min(1).max(100).default(20).describe('Max files to return'),
});
export type ListFilesInput = z.infer<typeof ListFilesSchema>;

export const GetDocumentSchema = z.object({
  filename: z.string().describe('Filename or relative path of the document to retrieve'),
});
export type GetDocumentInput = z.infer<typeof GetDocumentSchema>;
