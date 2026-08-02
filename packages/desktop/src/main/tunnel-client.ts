import WebSocket from 'ws';
import type { Store } from './store';
import type { IEmbedder } from './embedder';
import type { TunnelRequest, TunnelToolCall, TunnelToolResponse, TunnelPong, TunnelStatus } from '@nomnomdrive/shared';
import {
  executeSearchDocuments,
  executeListFiles,
  executeReadDocument,
} from './mcp/tools/handlers';
import type { SearchDocumentsInput, ReadDocumentInput, ListFilesInput } from '@nomnomdrive/shared';

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const MAX_AUTH_REFRESH_ATTEMPTS = 2;

export class TunnelClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private authRefreshAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentStatus: TunnelStatus = 'disconnected';

  constructor(
    private readonly serverUrl: string,
    private token: string,
    private readonly store: Store,
    private readonly embedder: IEmbedder,
    /** Exchange the stored refresh token for a fresh access token, or null if unavailable. */
    private readonly refreshFn?: () => Promise<string | null>,
    /** Notified on every tunnel status transition (connecting/connected/…/auth-expired). */
    private readonly onStatusChange?: (status: TunnelStatus) => void,
  ) {}

  getStatus(): TunnelStatus {
    return this.currentStatus;
  }

  private setStatus(status: TunnelStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    this.onStatusChange?.(status);
  }

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
    this.setStatus('disconnected');
  }

  private openConnection(): void {
    const url = `${this.serverUrl.replace(/^http/, 'ws')}/tunnel?token=${encodeURIComponent(this.token)}`;
    console.log(`[Tunnel] Connecting to ${this.serverUrl}`);
    this.setStatus('connecting');

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      console.log('[Tunnel] Connected');
      this.reconnectAttempt = 0;
      this.authRefreshAttempts = 0;
      this.setStatus('connected');
    });

    ws.on('message', (raw: Buffer | string) => {
      void this.handleMessage(raw.toString());
    });

    ws.on('close', (code) => {
      if (this.stopped) return;
      if (code === 4001) {
        console.error('[Tunnel] Authentication rejected — attempting token refresh');
        void this.handleAuthFailure();
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
    this.setStatus('reconnecting');
    const jitter = Math.random() * 1000;
    const delay = Math.min(MIN_BACKOFF_MS * 2 ** this.reconnectAttempt + jitter, MAX_BACKOFF_MS);
    this.reconnectAttempt++;
    console.log(`[Tunnel] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.openConnection();
    }, delay);
  }

  /**
   * The server rejected our credentials (close 4001). Try to mint a fresh access
   * token from the stored refresh token and reconnect immediately. Give up (and
   * notify the app) if no refresh is available, refresh fails, or we've already
   * retried too many times in a row — this avoids a tight refresh→reject loop.
   */
  private async handleAuthFailure(): Promise<void> {
    if (this.stopped) return;
    if (!this.refreshFn || this.authRefreshAttempts >= MAX_AUTH_REFRESH_ATTEMPTS) {
      console.error('[Tunnel] Cannot re-authenticate — re-login required');
      this.setStatus('auth-expired');
      return;
    }
    this.authRefreshAttempts++;
    const newToken = await this.refreshFn();
    if (this.stopped) return;
    if (!newToken) {
      console.error('[Tunnel] Token refresh failed — re-login required');
      this.setStatus('auth-expired');
      return;
    }
    console.log('[Tunnel] Token refreshed — reconnecting');
    this.token = newToken;
    this.openConnection();
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
        case 'list_files':
          response.mcpResult = await executeListFiles(
            this.store,
            msg.args as ListFilesInput,
          );
          break;
        case 'read_document':
          response.mcpResult = await executeReadDocument(
            this.store,
            msg.args as ReadDocumentInput,
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
