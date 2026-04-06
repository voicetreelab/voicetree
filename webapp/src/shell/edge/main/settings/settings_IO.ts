// Re-export shim — actual implementation in @vt/graph-model
export {
    loadSettings,
    saveSettings,
    clearSettingsCache,
    migrateAgentPromptCoreOnAppUpdateIfNeeded,
    migrateLayoutConfigIfNeeded,
    migrateStarredFoldersIfNeeded,
    migrateStarredFoldersBrainRename,
} from '@vt/graph-model'
