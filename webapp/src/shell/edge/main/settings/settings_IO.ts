// Re-export shim — actual implementation in @vt/app-config
export {
    loadSettings,
    saveSettings,
    clearSettingsCache,
    migrateLayoutConfigIfNeeded,
    migrateStarredFoldersIfNeeded,
    migrateStarredFoldersBrainRename,
} from '@vt/app-config/settings'
