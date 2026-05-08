import path from 'path'
import {getNodeId} from './primitives'

interface SelectableNode {
    readonly id: string
}

function normalizeRenderableNodeId(value: string): string {
    return value.replace(/\\/g, '/').replace(/\.md$/i, '')
}

function buildUniqueBasenameMap(nodeById: ReadonlyMap<string, SelectableNode>): ReadonlyMap<string, string> {
    const idsByBasename = new Map<string, string[]>()
    for (const nodeId of nodeById.keys()) {
        const basename: string = path.posix.basename(nodeId)
        const ids: string[] = idsByBasename.get(basename) ?? []
        ids.push(nodeId)
        idsByBasename.set(basename, ids)
    }

    const uniqueBasenames = new Map<string, string>()
    for (const [basename, ids] of idsByBasename) {
        if (ids.length === 1) {
            uniqueBasenames.set(basename, ids[0]!)
        }
    }
    return uniqueBasenames
}

export function resolveSelectedIds(
    rawSelectedIds: readonly string[],
    rootPath: string,
    nodeById: ReadonlyMap<string, SelectableNode>,
): ReadonlySet<string> {
    const resolved = new Set<string>()
    if (rawSelectedIds.length === 0) {
        return resolved
    }

    const uniqueBasenames: ReadonlyMap<string, string> = buildUniqueBasenameMap(nodeById)
    for (const rawSelectedId of rawSelectedIds) {
        const trimmed: string = rawSelectedId.trim()
        if (trimmed.length === 0) continue

        const exactId: string = path.posix.normalize(normalizeRenderableNodeId(trimmed))
        if (nodeById.has(exactId)) {
            resolved.add(exactId)
            continue
        }

        if (path.isAbsolute(trimmed)) {
            const absoluteId: string = getNodeId(rootPath, path.resolve(trimmed))
            if (nodeById.has(absoluteId)) {
                resolved.add(absoluteId)
                continue
            }
        }

        const basenameId: string | undefined = uniqueBasenames.get(path.posix.basename(exactId))
        if (basenameId !== undefined) {
            resolved.add(basenameId)
        }
    }

    return resolved
}
