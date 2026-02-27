/** Parse .doc (legacy Word 97-2003) using word-extractor (pure JS) */
export async function parseDoc(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WordExtractor = require('word-extractor') as new () => {
    extract(path: string): Promise<{ getBody(): string }>;
  };
  const extractor = new WordExtractor();
  const doc = await extractor.extract(filePath);
  return doc.getBody().trim();
}
