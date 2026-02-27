/** Parse .odt, .rtf, .pptx using officeparser */
export async function parseOffice(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const officeParser = require('officeparser') as {
    parseOfficeAsync(path: string): Promise<string>;
  };
  const text = await officeParser.parseOfficeAsync(filePath);
  return text.trim();
}
