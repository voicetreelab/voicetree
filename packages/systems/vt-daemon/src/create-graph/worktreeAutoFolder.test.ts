/**
 * Unit tests for worktree auto-folder placement (BF-447).
 *
 * Black-box over the two pure decision functions: resolveWorktreeRouting (where do
 * nodes land) and worktreeFolderNoteInput (is a folder identity note needed). These
 * cover the spec scenarios: worktree placement, explicit-outputPath override,
 * folder-note created once / converges, and non-worktree unchanged behaviour.
 */

import {describe, it, expect} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode, NodeIdAndFilePath, Position} from '@vt/graph-model/graph'
import {resolveWorktreeRouting, worktreeFolderNoteInput, type WorktreeRouting} from './createGraphTool'
import type {CreateGraphNodeInput} from './createGraphTypes'

function graphWith(nodeIds: readonly string[]): Graph {
    const nodes: Record<NodeIdAndFilePath, GraphNode> = {}
    for (const id of nodeIds) {
        nodes[id] = {
            kind: 'leaf',
            absoluteFilePathIsID: id,
            outgoingEdges: [],
            contentWithoutYamlOrLinks: '',
            nodeUIMetadata: {
                color: O.none as O.Option<string>,
                position: O.none as O.Option<Position>,
                additionalYAMLProps: {},
            },
        }
    }
    return {nodes, incomingEdgesIndex: new Map(), nodeByBaseName: new Map(), unresolvedLinksIndex: new Map()}
}

describe('resolveWorktreeRouting', () => {
    it('routes a worktree agent with no outputPath into the slugified worktree folder', () => {
        const routing: WorktreeRouting = resolveWorktreeRouting(undefined, 'wt-fix-auth-a3k')
        expect(routing).toEqual({outputPath: 'wt-fix-auth-a3k', active: true, worktreeName: 'wt-fix-auth-a3k'})
    })

    it('lets an explicit outputPath win over worktree routing', () => {
        const routing: WorktreeRouting = resolveWorktreeRouting('some/other/dir', 'wt-x')
        expect(routing).toEqual({outputPath: 'some/other/dir', active: false, worktreeName: null})
    })

    it('is inactive for a terminal with no worktree name', () => {
        expect(resolveWorktreeRouting(undefined, undefined)).toEqual({outputPath: undefined, active: false, worktreeName: null})
        expect(resolveWorktreeRouting(undefined, '   ')).toEqual({outputPath: undefined, active: false, worktreeName: null})
    })

    it('slugifies a non-slug-safe worktree name so it matches the folder note filename', () => {
        const routing: WorktreeRouting = resolveWorktreeRouting('', 'WT Fix Auth!')
        expect(routing.active).toBe(true)
        expect(routing.outputPath).toBe('wt-fix-auth')
    })
})

describe('worktreeFolderNoteInput', () => {
    const activeRouting: WorktreeRouting = {outputPath: 'wt-x', active: true, worktreeName: 'wt-x'}

    it('creates the folder identity note when routing is active and the folder is new', () => {
        const note: CreateGraphNodeInput | null = worktreeFolderNoteInput(activeRouting, '/w/wt-x', graphWith([]))
        expect(note).not.toBeNull()
        expect(note?.filename).toBe('wt-x')
        expect(note?.title).toBe('wt-x')
    })

    it('does not recreate the folder note when it already exists (convergence)', () => {
        const graph: Graph = graphWith(['/w/wt-x/wt-x.md'])
        expect(worktreeFolderNoteInput(activeRouting, '/w/wt-x', graph)).toBeNull()
    })

    it('creates no folder note when routing is inactive (explicit outputPath / non-worktree)', () => {
        const inactive: WorktreeRouting = {outputPath: 'some/dir', active: false, worktreeName: null}
        expect(worktreeFolderNoteInput(inactive, '/w/some/dir', graphWith([]))).toBeNull()
    })
})
