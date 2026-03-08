"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetDocumentSchema = exports.ListFoldersSchema = exports.SearchDocumentsSchema = void 0;
const zod_1 = require("zod");
exports.SearchDocumentsSchema = zod_1.z.object({
    query: zod_1.z.string().describe('Natural language search query'),
    limit: zod_1.z.number().int().min(1).max(20).default(5).describe('Max results to return'),
    folder: zod_1.z.string().optional().describe('Filter to a specific folder path'),
    file_type: zod_1.z
        .string()
        .optional()
        .describe('Filter by file type: pdf, docx, md, txt, etc.'),
});
exports.ListFoldersSchema = zod_1.z.object({});
exports.GetDocumentSchema = zod_1.z.object({
    filename: zod_1.z.string().describe('Filename or relative path of the document to retrieve'),
});
//# sourceMappingURL=mcp-schemas.js.map