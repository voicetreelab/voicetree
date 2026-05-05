// Re-export shim — actual implementation in @vt/graph-db-server
export {
    type VoiceTreeConfig,
    getConfigPath,
    loadConfig,
    saveConfig,
    getLastDirectory,
    saveLastDirectory,
    getVaultConfigForDirectory,
    saveVaultConfigForDirectory,
} from '@vt/graph-db-server/watch-folder/voicetree-config-io'
