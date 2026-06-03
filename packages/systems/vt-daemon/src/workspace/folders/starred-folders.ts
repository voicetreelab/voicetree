// Starred-folder persistence — the data layer behind the sidebar's starred
// section and the node context-menu "copy to starred folder". Starred folders
// live in the project settings (`settings.starredFolders`); these deep functions
// read/mutate that single field via the settings IO, leaving every other setting
// untouched. Reusable by both the Electron main process and VTD.

import type { VTSettings } from '@vt/graph-model/settings'
import { loadSettings, saveSettings } from '@vt/app-config/settings'

export async function getStarredFolders(): Promise<readonly string[]> {
    const settings: VTSettings = await loadSettings()
    return settings.starredFolders ?? []
}

export async function addStarredFolder(folderPath: string): Promise<void> {
    const settings: VTSettings = await loadSettings()
    const current: readonly string[] = settings.starredFolders ?? []
    if (current.includes(folderPath)) {
        return
    }
    await saveSettings({ ...settings, starredFolders: [...current, folderPath] })
}

export async function removeStarredFolder(folderPath: string): Promise<void> {
    const settings: VTSettings = await loadSettings()
    const current: readonly string[] = settings.starredFolders ?? []
    await saveSettings({ ...settings, starredFolders: current.filter((p: string) => p !== folderPath) })
}

export async function isStarred(folderPath: string): Promise<boolean> {
    return (await getStarredFolders()).includes(folderPath)
}
