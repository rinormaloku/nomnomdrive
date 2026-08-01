// ── Cloud → Agent ─────────────────────────────────────────────────────────────

export interface TunnelToolCall {
  type: 'tool_call';
  requestId: string;
  toolName: string;
  args: unknown;
}

export interface TunnelPing {
  type: 'ping';
}

export type TunnelRequest = TunnelPing | TunnelToolCall;

// ── Agent → Cloud ─────────────────────────────────────────────────────────────

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface TunnelToolResponse {
  type: 'tool_response';
  requestId: string;
  mcpResult?: { content: McpTextContent[] };
  error?: string;
}

export interface TunnelPong {
  type: 'pong';
}

export type TunnelResponse = TunnelPong | TunnelToolResponse;

// ── Tunnel connection status (agent → UI) ─────────────────────────────────────

/** Live state of the desktop→cloud tunnel, surfaced to the renderer. */
export type TunnelStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'auth-expired'
  | 'disconnected';
