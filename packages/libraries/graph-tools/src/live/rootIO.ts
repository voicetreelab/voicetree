import { promises as fsp } from 'node:fs'
import path from 'node:path'

import { buildGraphFromFiles, toAbsolutePath, type DirectoryEntry } from '@vt/graph-model'
import { configureRootIO } from '@vt/graph-state'
import * as E from 'fp-ts/lib/Either.js'

let configured = false

function shouldSkipEntry(name: string): boolean {
    return name === 'ctx-nodes' || name.startsWith('.')
}

async function readMarkdownFiles(rootPath: string): Promise<readonly { readonly absolutePath: string; readonly content: string }[]> {
    const files: { absolutePath: string; content: string }[] = []

    async function walk(dirPath: string): Promise<void> {
        const entries = await fsp.readdir(dirPath, {withFileTypes: true})
        const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name))

        for (const entry of sortedEntries) {
            if (shouldSkipEntry(entry.name)) continue

            const absolutePath = path.join(dirPath, entry.name)
            if (entry.isDirectory()) {
                await walk(absolutePath)
                continue
            }

            if (entry.isFile() && entry.name.endsWith('.md')) {
                files.push({
                    absolutePath,
                    content: await fsp.readFile(absolutePath, 'utf8'),
                })
            }
        }
    }

    await walk(rootPath)
    return files
}

async function getDirectoryTree(rootPath: string): Promise<DirectoryEntry> {
    const stats = await fsp.stat(rootPath)
    const absolutePath = path.resolve(rootPath)

    if (!stats.isDirectory()) {
        return {
            absolutePath: toAbsolutePath(absolutePath),
            name: path.basename(absolutePath),
            isDirectory: false,
        }
    }

    const entries = await fsp.readdir(absolutePath, {withFileTypes: true})
    const children = await Promise.all(
        entries
            .filter((entry) => !shouldSkipEntry(entry.name))
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((entry) => getDirectoryTree(path.join(absolutePath, entry.name))),
    )

    return {
        absolutePath: toAbsolutePath(absolutePath),
        name: path.basename(absolutePath),
        isDirectory: true,
        children,
    }
}

export function configureGraphToolsRootIO(): void {
    if (configured) return

    configureRootIO({
        getDirectoryTree,
        loadGraphFromDisk: async (projectRoots) => {
            try {
                const filesByProjectRoot = await Promise.all(
                    projectRoots.map((projectRoot) => readMarkdownFiles(path.resolve(projectRoot))),
                )
                return E.right(buildGraphFromFiles(filesByProjectRoot.flat()))
            } catch (error) {
                return E.left(error)
            }
        },
    })
    configured = true
}
