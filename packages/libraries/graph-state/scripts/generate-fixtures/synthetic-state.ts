import path from 'path'

import normalizePath from 'normalize-path'

import {
    buildGraphFromFiles,
    buildFolderTree,
    toAbsolutePath,
    type DirectoryEntry,
    type GraphNode,
} from '@vt/graph-model'

import type { Command, State } from '../../src/contract.ts'
import {
    collectLayoutPositions,
    serializeCommand,
    serializeState,
    type SequenceDocument,
    type SnapshotDocument,
} from '../../src/fixtures.ts'
import { abs, ROOT_A, type MarkdownFile, type SyntheticStateSpec } from './types.ts'

function buildDirectoryEntry(
    rootPath: string,
    files: readonly MarkdownFile[],
    extraDirs: readonly string[] = [],
): DirectoryEntry {
    interface MutableDirectory {
        readonly absolutePath: string
        readonly name: string
        readonly directories: Map<string, MutableDirectory>
        readonly files: Map<string, DirectoryEntry>
    }

    function createDirectory(absolutePath: string): MutableDirectory {
        return {
            absolutePath,
            name: path.posix.basename(absolutePath),
            directories: new Map(),
            files: new Map(),
        }
    }

    const root = createDirectory(rootPath)

    function ensureDirectory(relativeDir: string): MutableDirectory {
        const segments = relativeDir.split('/').filter(Boolean)
        let current = root
        let currentPath = rootPath

        for (const segment of segments) {
            currentPath = abs(currentPath, segment)
            const existing = current.directories.get(segment)
            if (existing) {
                current = existing
                continue
            }
            const next = createDirectory(currentPath)
            current.directories.set(segment, next)
            current = next
        }

        return current
    }

    for (const dir of extraDirs) {
        ensureDirectory(dir)
    }

    for (const file of files) {
        const normalizedRelative = normalizePath(file.relativePath)
        const segments = normalizedRelative.split('/').filter(Boolean)
        const fileName = segments.pop()
        if (!fileName) {
            continue
        }
        const parent = ensureDirectory(segments.join('/'))
        const absolutePath = abs(rootPath, normalizedRelative)
        parent.files.set(fileName, {
            absolutePath: toAbsolutePath(absolutePath),
            name: fileName,
            isDirectory: false,
        })
    }

    function finalize(dir: MutableDirectory): DirectoryEntry {
        const childDirs = [...dir.directories.values()]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map(finalize)
        const childFiles = [...dir.files.values()]
            .sort((left, right) => left.name.localeCompare(right.name))

        return {
            absolutePath: toAbsolutePath(dir.absolutePath),
            name: dir.name,
            isDirectory: true,
            children: [...childDirs, ...childFiles],
        }
    }

    return finalize(root)
}

export function createState(spec: SyntheticStateSpec): State {
    const loadedRoots = [...(spec.loadedRoots ?? spec.roots.map((root) => root.rootPath))]
        .map((rootPath) => normalizePath(rootPath))
        .sort((left, right) => left.localeCompare(right))
    const loadedRootSet = new Set(loadedRoots)
    const writeFolderPath = spec.writeFolderPath === null
        ? null
        : toAbsolutePath(normalizePath(spec.writeFolderPath ?? loadedRoots[0] ?? spec.roots[0]?.rootPath ?? ROOT_A))
    const filesForGraph = spec.roots
        .filter((root) => loadedRootSet.has(root.rootPath))
        .flatMap((root) => root.files.map((file) => ({
            absolutePath: abs(root.rootPath, file.relativePath),
            content: file.content,
        })))
        .sort((left, right) => left.absolutePath.localeCompare(right.absolutePath))
    const graph = buildGraphFromFiles(filesForGraph)
    const graphFilePaths = new Set(Object.keys(graph.nodes))
    const folderTree = spec.roots
        .filter((root) => loadedRootSet.has(root.rootPath))
        .sort((left, right) => left.rootPath.localeCompare(right.rootPath))
        .map((root) => buildFolderTree(
            buildDirectoryEntry(root.rootPath, root.files, root.extraDirs),
            loadedRootSet,
            writeFolderPath,
            graphFilePaths,
        ))

    return {
        graph,
        roots: {
            loaded: loadedRootSet,
            folderTree,
        },
        collapseSet: new Set(spec.collapseSet ?? []),
        selection: new Set(spec.selection ?? []),
        layout: {
            positions: collectLayoutPositions(graph),
            ...(spec.layout?.zoom !== undefined ? { zoom: spec.layout.zoom } : {}),
            ...(spec.layout?.pan ? { pan: spec.layout.pan } : {}),
            ...(spec.layout?.fit !== undefined ? { fit: spec.layout.fit } : {}),
        },
        meta: {
            schemaVersion: 1,
            revision: spec.meta?.revision ?? 0,
            ...(spec.meta?.mutatedAt ? { mutatedAt: spec.meta.mutatedAt } : {}),
        },
    }
}

export function snapshot(id: string, description: string, spec: SyntheticStateSpec): SnapshotDocument {
    return {
        $schema: 'graph-state/snapshot@1',
        id,
        description,
        state: serializeState(createState(spec)),
    }
}

export function sequence(
    id: string,
    description: string,
    initial: string,
    commands: readonly Command[],
    expected?: SequenceDocument['expected'],
): SequenceDocument {
    return {
        $schema: 'graph-state/sequence@1',
        id,
        description,
        initial,
        commands: commands.map(serializeCommand),
        ...(expected ? { expected } : {}),
    }
}

export function nodeFromMarkdown(rootPath: string, relativePath: string, content: string): GraphNode {
    const absolutePath = abs(rootPath, relativePath)
    return buildGraphFromFiles([{ absolutePath, content }]).nodes[absolutePath]
}
