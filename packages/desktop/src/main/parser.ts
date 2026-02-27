import path from 'path';
import { SUPPORTED_EXTENSIONS } from '@nomnomdrive/shared';
import { parseText } from './parsers/text';
import { parsePdf } from './parsers/pdf';
import { parseDocx } from './parsers/docx';
import { parseDoc } from './parsers/doc';
import { parseOffice } from './parsers/office';

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export async function parseDocument(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.md':
    case '.txt':
    case '.csv':
      return parseText(filePath, ext);
    case '.pdf':
      return parsePdf(filePath);
    case '.docx':
      return parseDocx(filePath);
    case '.doc':
      return parseDoc(filePath);
    case '.odt':
    case '.rtf':
    case '.pptx':
      return parseOffice(filePath);
    default:
      throw new Error(`Unsupported file extension: ${ext}`);
  }
}

export function isSupportedExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase() as SupportedExtension;
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}
