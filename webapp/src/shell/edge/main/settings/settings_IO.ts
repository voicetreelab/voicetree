// Re-export shim — actual implementation in @vt/graph-model
export {
    loadSettings,
    saveSettings,
    clearSettingsCache,
    migrateLayoutConfigIfNeeded,
    migrateStarredFoldersIfNeeded,
    migrateStarredFoldersBrainRename,
} from '@vt/graph-model'
