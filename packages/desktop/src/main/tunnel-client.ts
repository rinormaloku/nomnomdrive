import WebSocket from 'ws';
import type { Store } from './store';
import type { IEmbedder } from './embedder';
import type { TunnelRequest, TunnelToolCall, TunnelToolResponse, TunnelPong } from '@nomnomdrive/shared';
import {
  executeSearchDocuments,
  executeListFolders,
  executeGetDocument,
} from './mcp/tools/handlers';
import type { SearchDocumentsInput, GetDocumentInput } from '@nomnomdrive/shared';

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export class TunnelClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
    private readonly store: Store,
    private readonly embedder: IEmbedder,
  ) {}

  connect(): void {
    if (this.stopped) return;
    this.openConnection();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private openConnection(): void {
    const url = `${this.serverUrl.replace(/^http/, 'ws')}/tunnel?token=${encodeURIComponent(this.token)}`;
    console.log(`[Tunnel] Connecting to ${this.serverUrl}`);

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      console.log('[Tunnel] Connected');
      this.reconnectAttempt = 0;
    });

    ws.on('message', (raw: Buffer | string) => {
      void this.handleMessage(raw.toString());
    });

    ws.on('close', (code) => {
      if (this.stopped) return;
      if (code === 4001) {
        console.error('[Tunnel] Authentication rejected — check credentials');
        return;
      }
      console.log('[Tunnel] Disconnected — will reconnect');
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[Tunnel] Error:', err.message);
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const jitter = Math.random() * 1000;
    const delay = Math.min(MIN_BACKOFF_MS * 2 ** this.reconnectAttempt + jitter, MAX_BACKOFF_MS);
    this.reconnectAttempt++;
    console.log(`[Tunnel] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.openConnection();
    }, delay);
  }

  private async handleMessage(raw: string): Promise<void> {
    let msg: TunnelRequest;
    try {
      msg = JSON.parse(raw) as TunnelRequest;
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      const pong: TunnelPong = { type: 'pong' };
      this.send(pong);
      return;
    }

    if (msg.type === 'tool_call') {
      await this.dispatchToolCall(msg);
    }
  }

  private async dispatchToolCall(msg: TunnelToolCall): Promise<void> {
    const response: TunnelToolResponse = { type: 'tool_response', requestId: msg.requestId };
    try {
      switch (msg.toolName) {
        case 'search_documents':
          response.mcpResult = await executeSearchDocuments(
            this.store,
            this.embedder,
            msg.args as SearchDocumentsInput,
          );
          break;
        case 'list_folders':
          response.mcpResult = await executeListFolders(this.store);
          break;
        case 'get_document':
          response.mcpResult = await executeGetDocument(
            this.store,
            msg.args as GetDocumentInput,
          );
          break;
        default:
          response.error = `Unknown tool: ${msg.toolName}`;
      }
    } catch (err) {
      response.error = err instanceof Error ? err.message : String(err);
    }
    this.send(response);
  }

  private send(msg: TunnelToolResponse | TunnelPong): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
