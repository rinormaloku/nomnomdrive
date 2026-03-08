import { type AppConfig } from './config';
export interface SetupOptions {
    watchPath: string;
    embedModelId: string;
    chatModelId: string;
    mcpPort: number;
}
export type SetupPhase = 'embed' | 'chat';
export interface SetupProgress {
    phase: SetupPhase;
    modelId: string;
    modelLabel: string;
    downloaded: number;
    total: number;
}
export interface SetupStatus {
    needsSetup: boolean;
    needsModelDownload: boolean;
    existingConfig?: AppConfig;
    missingModels?: {
        embed: boolean;
        chat: boolean;
    };
}
/**
 * Check whether first-run setup is needed, or only model downloads.
 */
export declare function checkSetupStatus(): Promise<SetupStatus>;
/**
 * Returns the default setup options.
 */
export declare function getDefaultSetupOptions(): SetupOptions;
/**
 * Run the full setup: save config + download models.
 * This is the shared core that both CLI and Desktop UI call.
 *
 * @param options  User-selected setup options
 * @param onProgress  Called repeatedly during model downloads
 * @param onPhaseStart  Called when a new download phase begins (optional)
 */
export declare function runSetup(options: SetupOptions, onProgress?: (progress: SetupProgress) => void, onPhaseStart?: (phase: SetupPhase, modelId: string) => void): Promise<AppConfig>;
/**
 * Download only the missing models for an existing config.
 * Used when config exists but models were deleted or not yet downloaded.
 */
export declare function downloadMissingModels(config: AppConfig, onProgress?: (progress: SetupProgress) => void, onPhaseStart?: (phase: SetupPhase, modelId: string) => void): Promise<void>;
//# sourceMappingURL=setup-engine.d.ts.map