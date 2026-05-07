import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import { applyCommandWithDelta } from '../src/applyCommand'
import { loadSequence, loadSnapshot, serializeState } from '../src/fixtures'
import type { State } from '../src/contract'

function stateWithFixtureRevision(state: State, fixtureState: State): State {
    return {
        ...state,
        meta: {
            schemaVersion: state.meta.schemaVersion,
            revision: fixtureState.meta.revision,
            ...(fixtureState.meta.mutatedAt !== undefined
                ? { mutatedAt: fixtureState.meta.mutatedAt }
                : {}),
        },
    }
}

describe('applyCommand AddNode', () => {
    it('matches the 104-add-node-command fixture sequence', () => {
        const sequence = loadSequence('104-add-node-command')
        let state = sequence.initial
        let delta = undefined

        for (const command of sequence.commands) {
            const result = applyCommandWithDelta(state, command)
            state = result.state
            delta = result.delta
        }

        const expectedState = loadSnapshot(sequence.expected!.finalSnapshot!)

        expect(
            serializeState(stateWithFixtureRevision(state, expectedState)),
        ).toEqual(serializeState(expectedState))
        expect(state.meta.revision).toBe(sequence.initial.meta.revision + sequence.expected!.revisionDelta!)
        expect(delta?.graph).toHaveLength(1)
        expect(delta?.graph?.[0]?.type).toBe('UpsertNode')
        expect(delta?.graph?.[0]?.nodeToUpsert.absoluteFilePathIsID).toBe(
            '/tmp/graph-state-fixtures/root-a/delta.md',
        )
    })

    it('adds nested files to folderTree and mirrors node positions into layout.positions', () => {
        const initial = loadSnapshot('050-two-roots-root-a-only')
        const result = applyCommandWithDelta(initial, {
            type: 'AddNode',
            node: {
                outgoingEdges: [],
                absoluteFilePathIsID: '/tmp/graph-state-fixtures/root-a/tasks/zeta.md',
                contentWithoutYamlOrLinks: '# zeta\n\nPositioned child.\n',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 420, y: 180 }),
                    additionalYAMLProps: new Map(),
                },
            },
        })

        const rootA = result.state.roots.folderTree[0]
        const tasks = rootA.children.find(
            (child): child is typeof rootA =>
                'children' in child && child.absolutePath === '/tmp/graph-state-fixtures/root-a/tasks',
        )

        expect(tasks).toBeDefined()
        expect(tasks?.children).toEqual([
            {
                name: 'seed.md',
                absolutePath: '/tmp/graph-state-fixtures/root-a/tasks/seed.md',
                isInGraph: true,
            },
            {
                name: 'zeta.md',
                absolutePath: '/tmp/graph-state-fixtures/root-a/tasks/zeta.md',
                isInGraph: true,
            },
        ])
        expect(result.state.layout.positions.get('/tmp/graph-state-fixtures/root-a/tasks/zeta.md')).toEqual({
            x: 420,
            y: 180,
        })
        expect(result.state.meta.revision).toBe(initial.meta.revision + 1)
    })
})
