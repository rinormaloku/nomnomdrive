import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@nomnomdrive/shared';
import type { AppConfig } from '../config';
import type { Store } from '../store';
import type { Embedder } from '../embedder';
import { registerSearchTool } from './tools/search.tool';
import { registerFoldersTool } from './tools/folders.tool';
import { registerDocumentTool } from './tools/document.tool';

function buildMcpServer(store: Store, embedder: Embedder): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  registerSearchTool(server, store, embedder);
  registerFoldersTool(server, store);
  registerDocumentTool(server, store);

  return server;
}

export async function bootstrapMcpServer(
  config: AppConfig,
  store: Store,
  embedder: Embedder,
): Promise<void> {
  const httpServer = createServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }

    if (req.method === 'POST') {
      // Collect body
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end('Bad Request: invalid JSON');
        return;
      }

      // Stateless: fresh server + transport per request
      const mcpServer = buildMcpServer(store, embedder);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless — no session management
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      // Stateless mode: no persistent sessions
      res.writeHead(405, { Allow: 'POST' }).end('Method Not Allowed');
      return;
    }

    res.writeHead(405).end();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.mcp.port, '127.0.0.1', () => {
      console.log(`[MCP] Server listening on http://127.0.0.1:${config.mcp.port}/mcp`);
      resolve();
    });
  });
}
