/**
 * TDD test: verifies that agent_name frontmatter in a filesystem-written node
 * survives through the full pipeline: FS event → GraphDelta → graph state →
 * ElementSpec projection → applyGraphDeltaToUI data.
 *
 * This reproduces the bug where filesystem-written nodes with agent_name
 * do not get the blue terminal indicator edge in Cytoscape.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { initGraphModel } from '@vt/graph-model'
import { createEmptyGraph } from '@vt/graph-model/graph'
import { mapFSEventsToGraphDelta } from '@vt/graph-model/graph'
import { applyGraphDeltaToGraph } from '@vt/graph-model/graph'
import { project } from '@vt/graph-state'
import type { Graph, GraphDelta, FSUpdate } from '@vt/graph-model/graph'
import type { ProjectedGraph, ProjectedNode, State } from '@vt/graph-state/contract'

vi.mock('../../src/watch-folder/paths/project-allowlist', () => ({
    getProjectPaths: vi.fn(async () => []),
}))

function buildMinimalState(graph: Graph): State {
    return {
        graph,
        roots: { loaded: new Set(), folderTree: [] },
        collapseSet: new Set(),
        selection: new Set(),
        layout: { positions: new Map() },
        meta: { schemaVersion: 1, revision: 0 },
    }
}

function getAgentNameFromProjectedNode(node: ProjectedNode): string | undefined {
    const props = node.additionalYAMLProps
    if (!Array.isArray(props)) return undefined
    for (const entry of props) {
        if (Array.isArray(entry) && entry.length === 2 && entry[0] === 'agent_name') {
            return typeof entry[1] === 'string' ? entry[1] : undefined
        }
    }
    return undefined
}

describe('FS-written node with agent_name → blue edge data path', () => {
    beforeEach(() => {
        initGraphModel({})
    })

    it('agent_name survives: FS event → GraphDelta → graph → ElementSpec', () => {
        const content = `---
color: blue
agent_name: Victor
isContextNode: false
---
# Agent Progress
Some work was done.

[[parent-node]]`

        const fsEvent: FSUpdate = {
            absolutePath: '/project/agent-progress.md',
            content,
            eventType: 'Added',
        }

        const emptyGraph: Graph = createEmptyGraph()
        const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, emptyGraph)

        // Step 1: Verify delta contains agent_name in additionalYAMLProps
        expect(delta.length).toBeGreaterThanOrEqual(1)
        const upsert = delta[0]
        expect(upsert.type).toBe('UpsertNode')
        if (upsert.type !== 'UpsertNode') throw new Error('Expected UpsertNode')
        const yamlProps = upsert.nodeToUpsert.nodeUIMetadata.additionalYAMLProps
        expect(yamlProps['agent_name']).toBe('Victor')

        // Step 2: Apply delta to graph, verify node in graph has agent_name
        const graph: Graph = applyGraphDeltaToGraph(emptyGraph, delta)
        const node = graph.nodes['/project/agent-progress.md']
        expect(node).toBeDefined()
        expect(node.nodeUIMetadata.additionalYAMLProps['agent_name']).toBe('Victor')

        // Step 3: Project graph state to ProjectedGraph, verify agent_name survives
        const state: State = buildMinimalState(graph)
        const projected: ProjectedGraph = project(state)
        const projNode: ProjectedNode | undefined = projected.nodes.find(n => n.id === '/project/agent-progress.md')
        expect(projNode).toBeDefined()

        const agentName = getAgentNameFromProjectedNode(projNode!)
        expect(agentName).toBe('Victor')
    })

    it('node WITHOUT agent_name has no additionalYAMLProps entry for agent_name', () => {
        const content = `---
color: green
---
# Regular Node
No agent here.`

        const fsEvent: FSUpdate = {
            absolutePath: '/project/regular-node.md',
            content,
            eventType: 'Added',
        }

        const emptyGraph: Graph = createEmptyGraph()
        const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, emptyGraph)
        const graph: Graph = applyGraphDeltaToGraph(emptyGraph, delta)
        const state: State = buildMinimalState(graph)
        const projected: ProjectedGraph = project(state)
        const projNode: ProjectedNode | undefined = projected.nodes.find(n => n.id === '/project/regular-node.md')
        expect(projNode).toBeDefined()

        const agentName = getAgentNameFromProjectedNode(projNode!)
        expect(agentName).toBeUndefined()
    })
})
