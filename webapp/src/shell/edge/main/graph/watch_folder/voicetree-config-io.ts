// Re-export shim — actual implementation in @vt/graph-model
export {
    type VoiceTreeConfig,
    getConfigPath,
    loadConfig,
    saveConfig,
    getLastDirectory,
    saveLastDirectory,
    getVaultConfigForDirectory,
    saveVaultConfigForDirectory,
} from '@vt/graph-model'
