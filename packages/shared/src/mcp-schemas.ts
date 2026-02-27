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

export const GetDocumentSchema = z.object({
  filename: z.string().describe('Filename or relative path of the document to retrieve'),
});
export type GetDocumentInput = z.infer<typeof GetDocumentSchema>;
