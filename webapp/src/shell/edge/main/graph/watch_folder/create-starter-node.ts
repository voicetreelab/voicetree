/**
 * Creates a starter node when opening an empty folder.
 */

import path from 'path'
import { promises as fs } from 'fs'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode } from '@/pure/graph'
import { createGraph } from '@/pure/graph'
import { loadSettings } from '@/shell/edge/main/settings/settings_IO'
import type { VTSettings } from '@/pure/settings/types'

/**
 * Creates a starter node when opening an empty folder.
 * Uses the emptyFolderTemplate from settings, with {{DATE}} placeholder replaced.
 *
 * @param vaultPath - The vault path where the node file will be created
 * @returns Graph containing the new starter node
 */
export async function createStarterNode(vaultPath: string): Promise<Graph> {
    const settings: VTSettings = await loadSettings()
    const template: string = settings.emptyFolderTemplate ?? '# '

    // Format date: "Tuesday, 23 December"
    const now: Date = new Date()
    const dateStr: string = now.toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    })

    // Replace {{DATE}} placeholder with formatted date
    const content: string = template.replace(/\{\{DATE\}\}/g, dateStr)

    // Generate node ID with day-based folder: {dayAbbrev}/{timestamp}{randomChars}.md
    const dayAbbrev: string = now.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase()
    const timestamp: string = Date.now().toString()
    const randomChars: string = Array.from({length: 3}, () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.charAt(
            Math.floor(Math.random() * 52)
        )
    ).join('')

    const fileName: string = `${timestamp}${randomChars}.md`
    const relativePath: string = `${dayAbbrev}/${fileName}`

    // Node ID is the absolute path (consistent with loadGraphFromDisk)
    const absolutePath: string = path.join(vaultPath, relativePath)
    const nodeId: string = absolutePath

    // Create the node
    const newNode: GraphNode = {
        absoluteFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 0, y: 0 }),
            additionalYAMLProps: new Map(),
            isContextNode: false
        },
    }

    const graph: Graph = createGraph({ [nodeId]: newNode })

    // Write the file to disk
    const dirPath: string = path.dirname(absolutePath)
    await fs.mkdir(dirPath, { recursive: true })
    await fs.writeFile(absolutePath, content, 'utf-8')

    //console.log('[createStarterNode] Created starter node:', nodeId)

    return graph
}
