// Re-export from shared — this file exists for backwards-compatible imports
// within the desktop package. New code should import from @nomnomdrive/shared.
export {
  type WatchConfig,
  type ModelConfig,
  type McpConfig,
  type AppConfig,
  expandHome,
  getConfigDir,
  getConfigPath,
  getDataDir,
  getDbPath,
  getModelsDir,
  getDaemonSockPath,
  getDefaultDropFolder,
  getDefaultConfig,
  configExists,
  loadConfig,
  saveConfig,
  addWatchPath,
  removeWatchPath,
} from '@nomnomdrive/shared';
