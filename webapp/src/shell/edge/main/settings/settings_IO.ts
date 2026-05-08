// Re-export shim — actual implementation in @vt/app-config
export {
    loadSettings,
    saveSettings,
    clearSettingsCache,
    migrateAgentPromptCoreOnAppUpdateIfNeeded,
    migrateLayoutConfigIfNeeded,
    migrateStarredFoldersIfNeeded,
    migrateStarredFoldersBrainRename,
} from '@vt/app-config/settings'
