export interface WatchConfig {
    paths: string[];
    glob: string;
}
export interface ModelConfig {
    localEmbed: string;
    localChat: string;
}
export interface McpConfig {
    port: number;
}
export interface CloudConfig {
    serverUrl: string;
}
export interface AppConfig {
    mode: 'local' | 'cloud';
    watch: WatchConfig;
    model: ModelConfig;
    mcp: McpConfig;
    cloud?: CloudConfig;
}
export interface CloudCredentials {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
}
export declare function getCloudCredentialsPath(): string;
export declare function loadCloudCredentials(): Promise<CloudCredentials | null>;
export declare function saveCloudCredentials(creds: CloudCredentials): Promise<void>;
export declare function deleteCloudCredentials(): Promise<void>;
export declare function expandHome(p: string): string;
export declare function getConfigDir(): string;
export declare function getConfigPath(): string;
export declare function getDataDir(): string;
export declare function getDbPath(): string;
export declare function getModelsDir(): string;
export declare function getDaemonSockPath(): string;
export declare function getDefaultDropFolder(): string;
export declare function getDefaultConfig(): AppConfig;
export declare function configExists(): Promise<boolean>;
export declare function loadConfig(): Promise<AppConfig>;
export declare function saveConfig(config: AppConfig): Promise<void>;
export declare function addWatchPath(folderPath: string): Promise<AppConfig>;
export declare function removeWatchPath(folderPath: string): Promise<AppConfig>;
//# sourceMappingURL=config.d.ts.map