import { existsSync, promises as fs } from 'fs'
import path from 'path'

import * as E from 'fp-ts/lib/Either.js'
import normalizePath from 'normalize-path'

import {
    buildGraphFromFiles,
    toAbsolutePath,
    type DirectoryEntry,
} from '@vt/graph-model'

import { configureRootIO } from '../../src/rootIO.ts'

export function resolveFolderNodesProject(): string {
    const candidates = [
        path.resolve('brain/working-memory/tasks/folder-nodes'),
        path.resolve('brain/mem/tasks/folder-nodes'),
        path.resolve('../brain/mem/tasks/folder-nodes'),
        path.resolve('../../brain/mem/tasks/folder-nodes'),
        path.resolve('../../../brain/mem/tasks/folder-nodes'),
    ]
    const match = candidates.find((candidate) => existsSync(candidate))
    if (!match) {
        throw new Error(`folder-nodes project fixture source not found. Checked: ${candidates.join(', ')}`)
    }
    return match
}

async function getDirectoryTreeFromDisk(rootPath: string): Promise<DirectoryEntry> {
    const absolutePath = normalizePath(rootPath)
    const stat = await fs.stat(absolutePath)
    if (!stat.isDirectory()) {
        return {
            absolutePath: toAbsolutePath(absolutePath),
            name: path.basename(absolutePath),
            isDirectory: false,
        }
    }

    const entries = await fs.readdir(absolutePath, { withFileTypes: true })
    const children = await Promise.all(entries
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => getDirectoryTreeFromDisk(path.join(absolutePath, entry.name))))

    return {
        absolutePath: toAbsolutePath(absolutePath),
        name: path.basename(absolutePath),
        isDirectory: true,
        children,
    }
}

async function collectMarkdownFiles(rootPath: string): Promise<Array<{ absolutePath: string; content: string }>> {
    const absolutePath = normalizePath(rootPath)
    const stat = await fs.stat(absolutePath)
    if (stat.isDirectory()) {
        const entries = await fs.readdir(absolutePath, { withFileTypes: true })
        const nested = await Promise.all(entries
            .filter((entry) => !entry.name.startsWith('.'))
            .map((entry) => collectMarkdownFiles(path.join(absolutePath, entry.name))))
        return nested.flat()
    }

    if (!absolutePath.endsWith('.md')) {
        return []
    }

    return [{
        absolutePath,
        content: await fs.readFile(absolutePath, 'utf8'),
    }]
}

export function configureFixtureRootIO(): void {
    configureRootIO({
        getDirectoryTree: getDirectoryTreeFromDisk,
        loadGraphFromDisk: async (projectPaths) => {
            const files = (await Promise.all(projectPaths.map(collectMarkdownFiles))).flat()
            return E.right(buildGraphFromFiles(files))
        },
    })
}
