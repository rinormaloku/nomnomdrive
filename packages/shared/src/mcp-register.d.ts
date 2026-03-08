export interface RegistrationResult {
    client: string;
    registered: boolean;
    configPath: string;
}
export declare function registerMcpClients(mcpPort: number): Promise<RegistrationResult[]>;
/** Patch a single MCP client config by name (used by the renderer one-click install). */
export declare function patchMcpClientByName(clientName: string, mcpPort: number): Promise<RegistrationResult>;
//# sourceMappingURL=mcp-register.d.ts.map