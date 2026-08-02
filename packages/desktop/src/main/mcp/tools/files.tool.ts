import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Store } from '../../store';
import { ListFilesSchema } from '@nomnomdrive/shared';
import { executeListFiles } from './handlers';

export const LIST_FILES_TOOL_DESCRIPTION =
  'List the indexed files and the folders they come from, newest first. Use it to see ' +
  'what exists before searching, or to confirm a file name. Returns up to 20 files; ' +
  'pass a filter to narrow further.';

export function registerFilesTool(server: McpServer, store: Store): void {
  server.tool(
    'list_files',
    LIST_FILES_TOOL_DESCRIPTION,
    ListFilesSchema.shape,
    (args) => executeListFiles(store, args),
  );
}
