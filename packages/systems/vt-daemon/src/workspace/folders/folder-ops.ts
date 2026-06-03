// Folder filesystem mutations — create a subfolder, copy a node's markdown into
// a folder. Pure-of-deps (fs/path + @vt/graph-model pure helpers) so they are
// reusable by the Electron main process and VTD. Each is total: it returns a
// discriminated result rather than throwing, so callers render the error inline.

import { promises as fs } from 'fs'
import path from 'path'
import type { GraphNode, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { getNodeTitle, nodeIdToFilePathWithExtension } from '@vt/graph-model/markdown'
import { slugify } from '@vt/vt-daemon/_shared/slugify.ts'

export interface FolderMutationResult {
    readonly success: boolean
    readonly path?: string
    readonly error?: string
}

export interface CopyNodeResult {
    readonly success: boolean
    readonly targetPath: string
    readonly error?: string
}

export async function createSubfolder(
    parentPath: string,
    folderName: string,
): Promise<FolderMutationResult> {
    if (!folderName || folderName.includes('/') || folderName.includes('\\')) {
        return { success: false, error: 'Invalid folder name' }
    }
    const fullPath: string = path.join(parentPath, folderName)
    try {
        await fs.mkdir(fullPath, { recursive: true })
        return { success: true, path: fullPath }
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
    }
}

/**
 * Copy the markdown file backing `node` into `targetFolderPath`, naming the copy
 * after the node's (slugged) title and falling back to the source basename when
 * the title slugs to empty. `node` is supplied by the caller (resolved from the
 * graph) so this stays decoupled from any particular graph transport.
 */
export async function copyNodeToFolder(
    node: GraphNode | undefined,
    nodeId: string,
    targetFolderPath: string,
): Promise<CopyNodeResult> {
    if (!node) {
        return { success: false, targetPath: '', error: `Node not found: ${nodeId}` }
    }

    const sourceFilePath: string = nodeIdToFilePathWithExtension(nodeId as NodeIdAndFilePath)
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
