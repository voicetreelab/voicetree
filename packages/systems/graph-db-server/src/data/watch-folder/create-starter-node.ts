/**
 * Creates a starter node when opening an empty folder.
 */

import path from 'path'
import { promises as fs } from 'fs'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode } from '@vt/graph-model/graph'
import { createGraph } from '@vt/graph-model/graph'
import { loadSettings } from '@vt/app-config/settings'
import {resolveAppSupportPath} from '@vt/app-config/app-support-path'
import type { VTSettings } from '@vt/graph-model/settings'

export interface CreateStarterNodeDependencies {
    readonly loadSettings: () => Promise<VTSettings>
    readonly now: () => Date
    readonly nowMs: () => number
    readonly random: () => number
    readonly mkdir: (dirPath: string, options: { readonly recursive: true }) => Promise<void>
    readonly writeFile: (filePath: string, content: string, encoding: BufferEncoding) => Promise<void>
}

const defaultCreateStarterNodeDependencies: CreateStarterNodeDependencies = {
    loadSettings: () => loadSettings(resolveAppSupportPath()),
    now(): Date {
        return new Date()
    },
    nowMs(): number {
        return Date.now()
    },
    random(): number {
        return Math.random()
    },
    async mkdir(dirPath: string, options: { readonly recursive: true }): Promise<void> {
        await fs.mkdir(dirPath, options)
    },
    writeFile(filePath: string, content: string, encoding: BufferEncoding): Promise<void> {
        return fs.writeFile(filePath, content, encoding)
    },
}

export interface StarterNodePlan {
    readonly graph: Graph
    readonly absolutePath: string
    readonly content: string
}

function randomLetters(random: () => number, length: number): string {
    const alphabet: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    return Array.from({ length }, () =>
        alphabet.charAt(Math.floor(random() * alphabet.length))
    ).join('')
}

export function buildStarterNodePlan(
    projectRoot: string,
    template: string,
    now: Date,
    timestamp: string,
    randomChars: string,
): StarterNodePlan {
    const dateStr: string = now.toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    })
    const content: string = template.replace(/\{\{DATE\}\}/g, dateStr)
    const dayAbbrev: string = now.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase()
    const fileName: string = `${timestamp}${randomChars}.md`
    const relativePath: string = `${dayAbbrev}/${fileName}`
    const absolutePath: string = path.join(projectRoot, relativePath)
    const nodeId: string = absolutePath

    const newNode: GraphNode = {
        kind: 'leaf',
        absoluteFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 0, y: 0 }),
            additionalYAMLProps: {},
            isContextNode: false
        },
    }

    return {
        graph: createGraph({ [nodeId]: newNode }),
        absolutePath,
        content,
    }
}

/**
 * Creates a starter node when opening an empty folder.
 * Uses the emptyFolderTemplate from settings, with {{DATE}} placeholder replaced.
 *
 * @param projectRoot - The vault path where the node file will be created
 * @returns Graph containing the new starter node
 */
export async function createStarterNode(
    projectRoot: string,
    dependencies: CreateStarterNodeDependencies = defaultCreateStarterNodeDependencies,
): Promise<Graph> {
    const settings: VTSettings = await dependencies.loadSettings()
    const template: string = settings.emptyFolderTemplate ?? '# '

    const plan: StarterNodePlan = buildStarterNodePlan(
        projectRoot,
        template,
        dependencies.now(),
        dependencies.nowMs().toString(),
        randomLetters(dependencies.random, 3),
    )

    // Write the file to disk
    const dirPath: string = path.dirname(plan.absolutePath)
    await dependencies.mkdir(dirPath, { recursive: true })
    await dependencies.writeFile(plan.absolutePath, plan.content, 'utf-8')

    return plan.graph
}
