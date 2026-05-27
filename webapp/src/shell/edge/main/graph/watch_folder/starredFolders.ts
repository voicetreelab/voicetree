import { promises as fs } from 'fs'
import path from 'path'
import { getNodeThroughDaemon } from '@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-queries'
import { loadSettings, saveSettings } from '@/shell/edge/main/settings/settings_IO'
import { getAppSupportPath } from '@/shell/edge/main/runtime/state/app-electron-state'
import { getVaultPaths, getWriteFolder } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { uiAPI } from '@/shell/edge/main/runtime/ui-api-proxy'
import { nodeIdToFilePathWithExtension, getNodeTitle } from '@vt/graph-model/markdown'
import type { GraphNode } from '@vt/graph-model/graph'
import type { VTSettings } from '@vt/graph-model/settings'
import * as O from 'fp-ts/lib/Option.js'

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
}

async function syncVaultStateToRenderer(): Promise<void> {
    const settings: VTSettings = await loadSettings(getAppSupportPath())
    const writeFolderOption: O.Option<string> = await getWriteFolder()
    uiAPI.syncVaultState({
        readPaths: [...await getVaultPaths()],
        writeFolder: O.isSome(writeFolderOption) ? writeFolderOption.value : null,
        starredFolders: settings.starredFolders ?? [],
    })
}

export async function getStarredFolders(): Promise<readonly string[]> {
    const settings: VTSettings = await loadSettings(getAppSupportPath())
    return settings.starredFolders ?? []
}

export async function addStarredFolder(folderPath: string): Promise<void> {
    const settings: VTSettings = await loadSettings(getAppSupportPath())
    const current: readonly string[] = settings.starredFolders ?? []
    if (current.includes(folderPath)) {
        return
    }
    await saveSettings(getAppSupportPath(), { ...settings, starredFolders: [...current, folderPath] })
    await syncVaultStateToRenderer()
}

export async function removeStarredFolder(folderPath: string): Promise<void> {
    const settings: VTSettings = await loadSettings(getAppSupportPath())
    const current: readonly string[] = settings.starredFolders ?? []
    await saveSettings(getAppSupportPath(), { ...settings, starredFolders: current.filter((p: string) => p !== folderPath) })
    await syncVaultStateToRenderer()
}

export async function isStarred(folderPath: string): Promise<boolean> {
    return (await getStarredFolders()).includes(folderPath)
}

export async function copyNodeToFolder(
    nodeId: string,
    targetFolderPath: string,
): Promise<{ success: boolean; targetPath: string; error?: string }> {
    const node: GraphNode | undefined = await getNodeThroughDaemon(nodeId)
    if (!node) {
        return { success: false, targetPath: '', error: `Node not found: ${nodeId}` }
    }

    const sourceFilePath: string = nodeIdToFilePathWithExtension(nodeId)
    const title: string = getNodeTitle(node)
    const slugged: string = slugify(title)
    const fileName: string = slugged.length > 0 ? `${slugged}.md` : path.basename(sourceFilePath)
    const targetPath: string = path.join(targetFolderPath, fileName)

    try {
        await fs.access(targetFolderPath)
        await fs.copyFile(sourceFilePath, targetPath)
        return { success: true, targetPath }
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return { success: false, targetPath, error: message }
    }
}
