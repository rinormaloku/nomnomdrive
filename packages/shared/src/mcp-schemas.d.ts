import { z } from 'zod';
export declare const SearchDocumentsSchema: z.ZodObject<{
    query: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
    folder: z.ZodOptional<z.ZodString>;
    file_type: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SearchDocumentsInput = z.infer<typeof SearchDocumentsSchema>;
export declare const ListFoldersSchema: z.ZodObject<{}, z.core.$strip>;
export type ListFoldersInput = z.infer<typeof ListFoldersSchema>;
export declare const GetDocumentSchema: z.ZodObject<{
    filename: z.ZodString;
}, z.core.$strip>;
export type GetDocumentInput = z.infer<typeof GetDocumentSchema>;
//# sourceMappingURL=mcp-schemas.d.ts.map