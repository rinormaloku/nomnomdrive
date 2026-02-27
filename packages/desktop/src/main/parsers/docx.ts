import fs from 'fs/promises';
import mammoth from 'mammoth';

/** Parse .docx using mammoth (pure JS, excellent text fidelity) */
export async function parseDocx(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}
