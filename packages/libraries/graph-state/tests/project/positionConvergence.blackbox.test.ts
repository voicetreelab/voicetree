/**
 * Hot Zone C — Surface (a): Position convergence under add / remove / expand.
 *
 * Black-box test (CLAUDE.md): drives the public state + projection surface
 * (`applyCommand` + `project`). Asserts on the observable side effect —
 * positions in the projected graph — rather than on internals.
 *
 * Regression intent: prevents perpetual jitter where mutating the graph
 * (add-node, remove-node, expand-folder) would silently shift positions of
 * unrelated nodes via re-seeding or re-layout. The invariant: a node's
 * projected position is a fixed point under operations that do not name it.
 */

import { describe, expect, it } from 'vitest'

import type { NodeIdAndFilePath, Position } from '@vt/graph-model/graph'

import { applyCommand } from '../../src/applyCommand'
import type { Command, ProjectedGraph, State } from '../../src/contract'
import { loadSnapshot } from '../../src/fixtures'
import { project } from '../../src/project'

const ROOT: string = '/tmp/graph-state-fixtures/root-a'
const TASKS_FOLDER: string = `${ROOT}/tasks/`
const BF117: string = `${ROOT}/tasks/BF-117.md`
const BF118: string = `${ROOT}/tasks/BF-118.md`
const BF999_NEW: string = `${ROOT}/tasks/BF-999.md`

const SEED_POSITIONS: ReadonlyMap<NodeIdAndFilePath, Position> = new Map<NodeIdAndFilePath, Position>([
    [BF117, { x: 100, y: 200 }],
    [BF118, { x: 400, y: 200 }],
])

function seededState(): State {
    const base: State = loadSnapshot('010-flat-folder')
    return applyCommand(base, { type: 'SetPositions', positions: SEED_POSITIONS })
}

function projectedPositions(state: State): Map<string, Position> {
    const projected: ProjectedGraph = project(state)
    const out: Map<string, Position> = new Map<string, Position>()
    for (const node of projected.nodes) {
        if (node.kind === 'file' && node.position) {
            out.set(node.id, { x: node.position.x, y: node.position.y })
        }
    }
    return out
}

function applySequence(state: State, cmds: readonly Command[]): State {
    return cmds.reduce<State>((acc: State, c: Command): State => applyCommand(acc, c), state)
}

function setFolderState(state: 'expanded' | 'collapsed' | 'hidden'): Command {
    return {
        type: 'SetFolderState',
        viewId: 'main',
        path: TASKS_FOLDER.slice(0, -1),
        state,
    }
}

const EPSILON: number = 1e-9

describe('Hot Zone C (a) — Position convergence under add/remove/expand', () => {
    it('idempotent project: identical positions across repeated projections with no mutation', () => {
        const state: State = seededState()
        const first: Map<string, Position> = projectedPositions(state)
        const second: Map<string, Position> = projectedPositions(state)
        const third: Map<string, Position> = projectedPositions(state)

        expect(first.get(BF117)).toEqual({ x: 100, y: 200 })
        expect(first.get(BF118)).toEqual({ x: 400, y: 200 })
        expect(second).toEqual(first)
        expect(third).toEqual(first)
    })

    it('AddNode does not shift existing nodes: their projected positions are a fixed point', () => {
        const initial: State = seededState()
        const before: Map<string, Position> = projectedPositions(initial)

        const addCmd: Command = {
            type: 'AddNode',
            node: {
                outgoingEdges: [],
                absoluteFilePathIsID: BF999_NEW,
                contentWithoutYamlOrLinks: '# BF-999\n\nFresh node.\n',
                nodeUIMetadata: {
                    color: { _tag: 'None' } as never,
                    position: { _tag: 'None' } as never,
                    additionalYAMLProps: {},
                },
            } as never,
        }
        const after: State = applyCommand(initial, addCmd)
        const afterPositions: Map<string, Position> = projectedPositions(after)

        for (const [id, pos] of before) {
            const cur: Position | undefined = afterPositions.get(id)
            expect(cur, `Existing node ${id} disappeared after AddNode`).toBeDefined()
            expect(Math.abs((cur as Position).x - pos.x)).toBeLessThan(EPSILON)
            expect(Math.abs((cur as Position).y - pos.y)).toBeLessThan(EPSILON)
        }
    })

    it('RemoveNode does not shift remaining nodes: their projected positions are a fixed point', () => {
        const initial: State = seededState()
        const before: Map<string, Position> = projectedPositions(initial)

        const after: State = applyCommand(initial, { type: 'RemoveNode', id: BF118 })
        const afterPositions: Map<string, Position> = projectedPositions(after)

        const remaining: Position | undefined = afterPositions.get(BF117)
        expect(remaining).toBeDefined()
        expect(remaining).toEqual(before.get(BF117))
        expect(afterPositions.has(BF118)).toBe(false)
    })

    it('SetFolderState collapsed/expanded round-trip leaves visible-file positions identical to the starting projection', () => {
        const initial: State = seededState()
        const before: Map<string, Position> = projectedPositions(initial)

        // Collapsing the folder hides BF-117/BF-118 (they project under the folder).
        const collapsed: State = applyCommand(initial, setFolderState('collapsed'))
        const collapsedPositions: Map<string, Position> = projectedPositions(collapsed)
        expect(collapsedPositions.has(BF117)).toBe(false)
        expect(collapsedPositions.has(BF118)).toBe(false)

        // Re-expand: positions of the previously hidden file nodes return to their stored values.
        const reExpanded: State = applyCommand(collapsed, setFolderState('expanded'))
        const after: Map<string, Position> = projectedPositions(reExpanded)
        expect(after).toEqual(before)
    })

    it('long sequence of mutations does not accumulate drift on untouched nodes', () => {
        const initial: State = seededState()
        const beforeBF117: Position = projectedPositions(initial).get(BF117)!

        const mutations: readonly Command[] = [
            // Add-then-remove cycles — BF-117 must stay put through all of these.
            { type: 'AddNode', node: { outgoingEdges: [], absoluteFilePathIsID: `${ROOT}/tasks/A.md`, contentWithoutYamlOrLinks: 'A', nodeUIMetadata: { color: { _tag: 'None' }, position: { _tag: 'None' }, additionalYAMLProps: {} } } as never } as Command,
            { type: 'AddNode', node: { outgoingEdges: [], absoluteFilePathIsID: `${ROOT}/tasks/B.md`, contentWithoutYamlOrLinks: 'B', nodeUIMetadata: { color: { _tag: 'None' }, position: { _tag: 'None' }, additionalYAMLProps: {} } } as never } as Command,
            setFolderState('collapsed'),
            setFolderState('expanded'),
            { type: 'RemoveNode', id: `${ROOT}/tasks/A.md` },
            { type: 'RemoveNode', id: `${ROOT}/tasks/B.md` },
            setFolderState('collapsed'),
            setFolderState('expanded'),
        ]

        const final: State = applySequence(initial, mutations)
        const finalBF117: Position | undefined = projectedPositions(final).get(BF117)
        expect(finalBF117).toBeDefined()
        expect(Math.abs((finalBF117 as Position).x - beforeBF117.x)).toBeLessThan(EPSILON)
        expect(Math.abs((finalBF117 as Position).y - beforeBF117.y)).toBeLessThan(EPSILON)
    })
})
