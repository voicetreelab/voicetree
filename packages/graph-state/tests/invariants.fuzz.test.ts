import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import type { FolderTreeNode } from '@vt/graph-model'

import { applyCommand } from '../src/applyCommand'
import type { Command, FolderId, State } from '../src/contract'
import { listSnapshotDocuments } from '../src/fixtures'

// ---- Mulberry32 seeded PRNG (no deps, deterministic replay) ----

function mulberry32(seed: number): () => number {
    let a = seed
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// ---- Command generation ----

// Expand to 11 once BF-150 (AddEdge) + BF-152 (Move/LoadRoot/UnloadRoot) land —
// just add them here and in the switch below.
const SUPPORTED_COMMANDS = [
    'Collapse', 'Expand', 'Select', 'Deselect', 'AddNode', 'RemoveNode', 'RemoveEdge',
] as const
type SupportedCommandType = (typeof SUPPORTED_COMMANDS)[number]

function pick<T>(rng: () => number, arr: readonly T[]): T {
    return arr[Math.floor(rng() * arr.length)] as T
}

function collectFolderIds(tree: readonly FolderTreeNode[]): FolderId[] {
    const ids: FolderId[] = []
    for (const node of tree) {
        ids.push(`${node.absolutePath}/`)
        for (const child of node.children) {
            if ('children' in child) {
                ids.push(...collectFolderIds([child as FolderTreeNode]))
            }
        }
    }
    return ids
}

// Module-level counter ensures each AddNode produces a unique path across all sequences.
let _nodeSeq = 0

function generateCommand(rng: () => number, state: State): Command | null {
    const nodeIds = Object.keys(state.graph.nodes)
    const folderIds = collectFolderIds(state.roots.folderTree)
    const baseRoot = [...state.roots.loaded][0] ?? '/tmp/fuzz-root'

    const candidates = (SUPPORTED_COMMANDS as readonly SupportedCommandType[]).filter((t) => {
        if (t === 'Collapse' || t === 'Expand') return folderIds.length > 0
        if (t === 'RemoveNode' || t === 'RemoveEdge') return nodeIds.length > 0
        return true
    })

    if (candidates.length === 0) return null
    const type = pick(rng, candidates)

    switch (type) {
        case 'Collapse':
            return { type: 'Collapse', folder: pick(rng, folderIds) }

        case 'Expand': {
            const collapsed = [...state.collapseSet]
            return { type: 'Expand', folder: pick(rng, collapsed.length > 0 ? collapsed : folderIds) }
        }

        case 'Select': {
            if (nodeIds.length === 0) return { type: 'Select', ids: [], additive: false }
            const count = 1 + Math.floor(rng() * Math.min(3, nodeIds.length))
            const ids = Array.from({ length: count }, () => pick(rng, nodeIds))
            return { type: 'Select', ids, additive: rng() < 0.5 }
        }

        case 'Deselect': {
            const selected = [...state.selection]
            if (selected.length === 0) return { type: 'Deselect', ids: [] }
            const count = 1 + Math.floor(rng() * selected.length)
            return { type: 'Deselect', ids: Array.from({ length: count }, () => pick(rng, selected)) }
        }

        case 'AddNode': {
            const id = `${baseRoot}/fuzz-node-${_nodeSeq++}.md`
            return {
                type: 'AddNode',
                node: {
                    absoluteFilePathIsID: id,
                    outgoingEdges: [],
                    contentWithoutYamlOrLinks: '# Fuzz\n',
                    nodeUIMetadata: {
                        color: O.none,
                        position: O.none,
                        additionalYAMLProps: new Map<string, string>(),
                    },
                },
            }
        }

        case 'RemoveNode':
            return { type: 'RemoveNode', id: pick(rng, nodeIds) }

        case 'RemoveEdge': {
            const withEdges = Object.values(state.graph.nodes).filter((n) => n.outgoingEdges.length > 0)
            if (withEdges.length === 0) {
                // No-op: source has no outgoing edges; applyRemoveEdge handles gracefully.
                return { type: 'RemoveEdge', source: pick(rng, nodeIds), targetId: '__nonexistent__' }
            }
            const src = pick(rng, withEdges)
            const edge = pick(rng, src.outgoingEdges)
            return { type: 'RemoveEdge', source: src.absoluteFilePathIsID, targetId: edge.targetId }
        }
    }
}

// ---- Invariant assertions ----

function assertInvariants(state: State, ctx: string): void {
    const nodeIds = new Set(Object.keys(state.graph.nodes))

    // I1: selection ⊆ graph.nodes
    for (const id of state.selection) {
        if (!nodeIds.has(id)) {
            throw new Error(`[${ctx}] I1 orphan selection id "${id}"`)
        }
    }

    // I2: collapseSet ⊆ folders derivable from folderTree
    const folderIds = new Set(collectFolderIds(state.roots.folderTree))
    for (const folder of state.collapseSet) {
        if (!folderIds.has(folder)) {
            throw new Error(`[${ctx}] I2 collapseSet folder "${folder}" not in folderTree`)
        }
    }

    // I3: revision strictly monotonic — checked at the caller level

    // I4: incomingEdgesIndex consistent with outgoing edges
    for (const [nodeId, node] of Object.entries(state.graph.nodes)) {
        for (const edge of node.outgoingEdges) {
            const incoming = state.graph.incomingEdgesIndex.get(edge.targetId)
            if (incoming === undefined || !incoming.includes(nodeId)) {
                throw new Error(
                    `[${ctx}] I4 edge ${nodeId}→${edge.targetId} missing from incomingEdgesIndex`,
                )
            }
        }
    }

    // I5: layout.positions keys ⊆ graph.nodes
    for (const [posId] of state.layout.positions) {
        if (!nodeIds.has(posId)) {
            throw new Error(`[${ctx}] I5 orphan position id "${posId}"`)
        }
    }
}

// ---- Fuzzer ----

describe('invariant fuzzer (10k sequences, 0 violations)', () => {
    it('holds all structural invariants across 10k random command sequences', () => {
        const snapshots = listSnapshotDocuments()
        const SEED = 0xDEADBEEF
        const SEQUENCES = 10_000
        const topRng = mulberry32(SEED)

        for (let seq = 0; seq < SEQUENCES; seq++) {
            // Derive a per-sequence seed for deterministic repro:  re-run with same SEED and seq index.
            const seqSeed = (topRng() * 0xFFFFFFFF) >>> 0
            const seqRng = mulberry32(seqSeed)

            const snapshotIdx = Math.floor(topRng() * snapshots.length)
            let state = snapshots[snapshotIdx]!.state

            const seqLen = 10 + Math.floor(seqRng() * 41) // 10..50
            let prevRevision = state.meta.revision - 1

            for (let step = 0; step < seqLen; step++) {
                const cmd = generateCommand(seqRng, state)
                if (cmd === null) break

                const ctx = `seq=${seq} seed=0x${seqSeed.toString(16)} step=${step} cmd=${cmd.type}`
                state = applyCommand(state, cmd)

                // I3: revision strictly monotonic
                expect(
                    state.meta.revision,
                    `[${ctx}] I3 revision must be > ${prevRevision}`,
                ).toBeGreaterThan(prevRevision)
                prevRevision = state.meta.revision

                assertInvariants(state, ctx)
            }
        }
    })
})
