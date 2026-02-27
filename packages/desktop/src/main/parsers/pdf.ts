import fs from 'fs/promises';

/** Parse .pdf using pdf-parse (pure JS, no native bindings) */
export async function parsePdf(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (
    buffer: Buffer,
    options?: object,
  ) => Promise<{ text: string }>;

  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text.trim();
}
