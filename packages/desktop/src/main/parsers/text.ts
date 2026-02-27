import fs from 'fs/promises';

/** Parse .md, .txt, .csv — pure Node.js, no dependencies */
export async function parseText(filePath: string, ext: string): Promise<string> {
  const raw = await fs.readFile(filePath, 'utf-8');

  if (ext === '.md') {
    return stripMarkdown(raw);
  }

  if (ext === '.csv') {
    // Return CSV as tab-separated text for better embedding
    return raw
      .split('\n')
      .map((line) => line.replace(/,/g, '\t'))
      .join('\n');
  }

  return raw;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1') // italic
    .replace(/~~(.+?)~~/g, '$1') // strikethrough
    .replace(/`{3}[\s\S]*?`{3}/g, '') // code blocks
    .replace(/`(.+?)`/g, '$1') // inline code
    .replace(/!\[.*?\]\(.*?\)/g, '') // images
    .replace(/\[(.+?)\]\(.*?\)/g, '$1') // links
    .replace(/^>\s+/gm, '') // blockquotes
    .replace(/^[-*+]\s+/gm, '') // unordered lists
    .replace(/^\d+\.\s+/gm, '') // ordered lists
    .replace(/^\s*---+\s*$/gm, '') // horizontal rules
    .replace(/\n{3,}/g, '\n\n') // excessive blank lines
    .trim();
}
