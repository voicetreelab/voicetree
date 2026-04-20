import {existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync} from 'fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {ensureDaemon, GraphDbClient, type GraphState} from '@vt/graph-db-client'
import {fromNodeToMarkdownContent, type GraphNode} from '@vt/graph-model'
import {resolveVault} from '../../util/detectVault.ts'
import {isRecord} from './util.ts'

const NONE_OPTION: {readonly _tag: 'None'} = {_tag: 'None'}

function normalizeAdditionalYAMLProps(value: unknown): ReadonlyMap<string, string> {
    if (value instanceof Map) {
        return new Map(
            [...value.entries()].map(([key, entryValue]) => [
                String(key),
                typeof entryValue === 'string' ? entryValue : JSON.stringify(entryValue),
            ]),
        )
    }

    if (!isRecord(value)) {
        return new Map()
    }

    return new Map(
        Object.entries(value).map(([key, entryValue]) => [
            key,
            typeof entryValue === 'string' ? entryValue : JSON.stringify(entryValue),
        ]),
    )
}

export function canonicalizePath(filePath: string): string {
    try {
        return realpathSync(filePath)
    } catch {
        return path.resolve(filePath)
    }
}

export function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
    const relativePath: string = path.relative(canonicalizePath(rootPath), canonicalizePath(candidatePath))
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export function assertGraphRootExists(folderPath: string): void {
    if (!existsSync(folderPath)) {
        throw new Error(`ENOENT: no such file or directory, scandir '${folderPath}'`)
    }

    if (!statSync(folderPath).isDirectory()) {
        throw new Error(`ENOTDIR: not a directory, scandir '${folderPath}'`)
    }
}

export function resolveGraphVault(folderPath: string): string {
    try {
        return resolveVault({cwd: folderPath})
    } catch {
        return resolveVault({cwd: process.cwd()})
    }
}

export function hydrateGraphNode(absoluteFilePath: string, rawNode: unknown): GraphNode {
    const nodeRecord: Record<string, unknown> = isRecord(rawNode) ? rawNode : {}
    const metadataRecord: Record<string, unknown> = isRecord(nodeRecord.nodeUIMetadata)
        ? nodeRecord.nodeUIMetadata
        : {}

    const outgoingEdges: GraphNode['outgoingEdges'] = Array.isArray(nodeRecord.outgoingEdges)
        ? nodeRecord.outgoingEdges
            .filter(
                (edge: unknown): edge is {targetId: string; label?: string} =>
                    isRecord(edge) && typeof edge.targetId === 'string',
            )
            .map((edge: {targetId: string; label?: string}) => ({
                targetId: edge.targetId,
                label: typeof edge.label === 'string' ? edge.label : '',
            }))
        : []

    const containedNodeIds: readonly string[] | undefined = Array.isArray(metadataRecord.containedNodeIds)
        ? metadataRecord.containedNodeIds.filter((value: unknown): value is string => typeof value === 'string')
        : undefined

    return {
        kind: nodeRecord.kind === 'folder' ? 'folder' : 'leaf',
        absoluteFilePathIsID: typeof nodeRecord.absoluteFilePathIsID === 'string'
            ? nodeRecord.absoluteFilePathIsID
            : absoluteFilePath,
        outgoingEdges,
        contentWithoutYamlOrLinks: typeof nodeRecord.contentWithoutYamlOrLinks === 'string'
            ? nodeRecord.contentWithoutYamlOrLinks
            : '',
        nodeUIMetadata: {
            color: (metadataRecord.color ?? NONE_OPTION) as GraphNode['nodeUIMetadata']['color'],
            position: (metadataRecord.position ?? NONE_OPTION) as GraphNode['nodeUIMetadata']['position'],
            additionalYAMLProps: normalizeAdditionalYAMLProps(metadataRecord.additionalYAMLProps),
            ...(metadataRecord.isContextNode === true ? {isContextNode: true} : {}),
            ...(containedNodeIds ? {containedNodeIds} : {}),
        },
    }
}

export function materializeGraphSnapshot(
    graph: GraphState,
    folderPath: string,
): {cleanupPath: string; snapshotRoot: string} {
    const cleanupPath: string = mkdtempSync(path.join(tmpdir(), 'vt-graph-daemon-'))
    const canonicalFolderPath: string = canonicalizePath(folderPath)
    const snapshotRoot: string = path.join(cleanupPath, path.basename(canonicalFolderPath))
    mkdirSync(snapshotRoot, {recursive: true})
    const nodeEntries: Array<readonly [string, unknown]> = Object.entries(graph.nodes)
        .filter(([absoluteFilePath]: readonly [string, unknown]) => isPathInsideRoot(folderPath, absoluteFilePath))
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))

    for (const [absoluteFilePath, rawNode] of nodeEntries) {
        const relativeFilePath: string = path.relative(canonicalFolderPath, canonicalizePath(absoluteFilePath))
        if (relativeFilePath.startsWith('..') || path.isAbsolute(relativeFilePath)) {
            continue
        }

        const snapshotFilePath: string = path.join(snapshotRoot, relativeFilePath)
        mkdirSync(path.dirname(snapshotFilePath), {recursive: true})
        writeFileSync(
            snapshotFilePath,
            fromNodeToMarkdownContent(hydrateGraphNode(absoluteFilePath, rawNode)),
            'utf8',
        )
    }

    return {cleanupPath, snapshotRoot}
}

export async function withDaemonGraphSnapshot<T>(
    folderPath: string,
    run: (snapshotRoot: string) => Promise<T> | T,
): Promise<T> {
    assertGraphRootExists(folderPath)
    const vault: string = resolveGraphVault(folderPath)
    const {port}: {port: number} = await ensureDaemon(vault)
    const client = new GraphDbClient({
        baseUrl: `http://127.0.0.1:${port}`,
    })
    const graph: GraphState = await client.getGraph()
    const {cleanupPath, snapshotRoot}: {cleanupPath: string; snapshotRoot: string} = materializeGraphSnapshot(
        graph,
        folderPath,
    )

    try {
        return await run(snapshotRoot)
    } finally {
        rmSync(cleanupPath, {recursive: true, force: true})
    }
}
