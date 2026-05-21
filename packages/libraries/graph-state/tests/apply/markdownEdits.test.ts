import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import { createEmptyGraph, type GraphNode } from '@vt/graph-model'

import {
    createEdgesAddedGraphDelta,
    rebuildSourceNodeForRemovedEdge,
} from '../../src/apply/markdownEdits'
import type { State } from '../../src/contract'

const SOURCE = '/vault/source.md'
const TARGET = '/vault/target.md'
const OTHER = '/vault/other.md'

function node(
    contentWithoutYamlOrLinks: string,
    outgoingEdges: GraphNode['outgoingEdges'] = [],
): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: SOURCE,
        contentWithoutYamlOrLinks,
        outgoingEdges,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
        },
    }
}

function stateWithGraphNode(sourceNode: GraphNode): State {
    return {
        graph: {
            ...createEmptyGraph(),
            nodes: { [SOURCE]: sourceNode },
        },
        roots: { loaded: new Set(), folderTree: [] },
        collapseSet: new Set(),
        selection: new Set(),
        layout: { positions: new Map() },
        meta: { schemaVersion: 1, revision: 0 },
    }
}

describe('markdown edge edit helpers', () => {
    it('creates an enumerable edgesAdded graph delta summary', () => {
        const edge = { source: SOURCE, targetId: TARGET, label: 'relates' }
        const delta = createEdgesAddedGraphDelta([edge]) as unknown as {
            readonly edgesAdded?: readonly typeof edge[]
        }

        expect(delta.edgesAdded).toEqual([edge])
        expect(Object.keys(delta)).toEqual(['edgesAdded'])
    })

    it('returns unchanged content when removing from markdown with no wikilinks', () => {
        const sourceNode = node('# Source\n\nNo links here.', [])

        const rebuilt = rebuildSourceNodeForRemovedEdge(
            stateWithGraphNode(sourceNode),
            sourceNode,
            TARGET,
        )

        expect(rebuilt.contentWithoutYamlOrLinks).toBe('# Source\n\nNo links here.')
        expect(rebuilt.outgoingEdges).toEqual([])
    })

    it('keeps unmatched wikilinks when there is no corresponding outgoing edge', () => {
        const sourceNode = node('# Source\n\nLoose [ghost]* link.', [])

        const rebuilt = rebuildSourceNodeForRemovedEdge(
            stateWithGraphNode(sourceNode),
            sourceNode,
            TARGET,
        )

        expect(rebuilt.contentWithoutYamlOrLinks).toBe('# Source\n\nLoose [ghost]* link.')
        expect(rebuilt.outgoingEdges).toEqual([{ targetId: 'ghost', label: 'Loose' }])
    })

    it('normalizes conjunction, punctuation, comma, and repeated-space artifacts after link removal', () => {
        const sourceNode = node(
            [
                '# Source',
                '',
                'Keep [other]* and  [target]*.',
                'Bang [target]*   !',
                'Comma, [target]*;',
                'Words [target]*  apart.',
            ].join('\n'),
            [
                { targetId: OTHER, label: 'Keep' },
                { targetId: TARGET, label: 'and' },
                { targetId: TARGET, label: 'Bang' },
                { targetId: TARGET, label: 'Comma' },
                { targetId: TARGET, label: 'Words' },
            ],
        )

        const rebuilt = rebuildSourceNodeForRemovedEdge(
            stateWithGraphNode(sourceNode),
            sourceNode,
            TARGET,
        )

        expect(rebuilt.contentWithoutYamlOrLinks).toBe([
            '# Source',
            '',
            'Keep [other]*.',
            'Bang!',
            'Comma;',
            'Words apart.',
        ].join('\n'))
        expect(rebuilt.outgoingEdges).toEqual([{ targetId: 'other', label: 'Keep' }])
    })
})
