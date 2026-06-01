// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import type { GraphDelta, GraphNode } from '@vt/graph-model/graph'
import { syncProjectStateFromMain } from '@/shell/edge/UI-edge/state/stores/ProjectPathStore'
import { resetTestProjectionState, setTestCollapseSet } from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import { addTerminal, clearTerminals } from '@/shell/edge/UI-edge/state/stores/TerminalStore'
import { createTerminalData, getShadowNodeId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import type { TerminalId, NodeIdAndFilePath } from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import { O, upsert, applyDeltaToUI } from './applyGraphDeltaToUI.test-utils'

vi.mock('@/shell/edge/UI-edge/graph/popups/userEngagementPrompts', () => ({
    checkEngagementPrompts: vi.fn()
}))

const AGENT: string = 'Amy_1'
const NODE_ID: string = '/project/progress-node.md'

function makeNode(agentName?: string): GraphNode {
    return {
        absoluteFilePathIsID: NODE_ID,
        contentWithoutYamlOrLinks: '# Progress Node',
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 0, y: 0 }),
            additionalYAMLProps: agentName ? { agent_name: agentName } : {},
            isContextNode: false,
        },
    }
}

function makeNodeWithId(nodeId: string, agentName?: string): GraphNode {
    return {
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: '# Progress Node',
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 0, y: 0 }),
            additionalYAMLProps: agentName ? { agent_name: agentName } : {},
            isContextNode: false,
        },
    }
}

function deltaWith(node: GraphNode): GraphDelta {
    return [upsert(node)]
}

/**
 * Reproduces the "blue terminal→progress edge is unreliable" bug.
 *
 * The indicator edge (class `terminal-progres-nodes-indicator`) connects a live
 * terminal's shadow node to progress nodes that terminal authored, matched by the
 * node's `agent_name` YAML against `terminal.agentName`.
 *
 * `vt graph create` frequently injects `agent_name` via frontmatter-completion AFTER
 * the node first appears — so the renderer's first ("new node") delta lacks agent_name
 * and the later delta that carries it is an UPDATE. Before the fix the edge was only
 * ever created on the new-node branch, so update-delivered agent_name never produced
 * an edge.
 */
describe('applyGraphDeltaToUI — terminal→progress indicator edge', () => {
    let cy: Core

    beforeEach(() => {
        resetTestProjectionState()
        clearTerminals()
        cy = cytoscape({ headless: true, elements: [] })
        // A live terminal whose agentName matches the node's agent_name, plus its
        // shadow node present in the graph (the edge endpoint).
        addTerminal(createTerminalData({
            terminalId: AGENT as TerminalId,
            attachedToNodeId: '/project/task.md' as NodeIdAndFilePath,
            terminalCount: 0,
            title: AGENT,
            agentName: AGENT,
        }))
        cy.add({
            group: 'nodes',
            data: { id: getShadowNodeId(AGENT as TerminalId), isShadowNode: true },
        })
    })

    afterEach(() => {
        cy.destroy()
        clearTerminals()
        setTestCollapseSet(new Set())
        syncProjectStateFromMain({ readPaths: [], writeFolderPath: null, starredFolders: [] })
    })

    function indicatorEdgeCount(): number {
        return cy.edges('.terminal-progres-nodes-indicator').length
    }

    it('creates the edge when agent_name is present on the first (new-node) delta', () => {
        applyDeltaToUI(cy, deltaWith(makeNode(AGENT)))
        expect(indicatorEdgeCount()).toBe(1)
    })

    it('creates the edge when agent_name arrives on a later UPDATE delta (regression)', () => {
        // First delta: node appears WITHOUT agent_name (frontmatter not yet completed).
        applyDeltaToUI(cy, deltaWith(makeNode(undefined)))
        expect(cy.getElementById(NODE_ID).length).toBe(1)
        expect(indicatorEdgeCount()).toBe(0)

        // Second delta: same node, now WITH agent_name (frontmatter completion). This is
        // an update path because the node already exists in cy.
        applyDeltaToUI(cy, deltaWith(makeNode(AGENT)))
        expect(indicatorEdgeCount()).toBe(1)
    })

    it('does not duplicate the edge across repeated update deltas (idempotent)', () => {
        applyDeltaToUI(cy, deltaWith(makeNode(AGENT)))
        applyDeltaToUI(cy, deltaWith(makeNode(AGENT)))
        applyDeltaToUI(cy, deltaWith(makeNode(AGENT)))
        expect(indicatorEdgeCount()).toBe(1)
    })

    it('weights edges by recency: newest = 1 (thickest/solid), oldest = 0 (thin/faded)', () => {
        // Three nodes authored by the same agent, in creation order: oldest → newest.
        applyDeltaToUI(cy, deltaWith(makeNodeWithId('/project/n1.md', AGENT)))
        applyDeltaToUI(cy, deltaWith(makeNodeWithId('/project/n2.md', AGENT)))
        applyDeltaToUI(cy, deltaWith(makeNodeWithId('/project/n3.md', AGENT)))
        expect(indicatorEdgeCount()).toBe(3)

        const shadowNodeId: string = getShadowNodeId(AGENT as TerminalId)
        const edgeId = (target: string): string => `terminal-progress-${shadowNodeId}->${target}`
        const weightOf = (target: string): number =>
            cy.getElementById(edgeId(target)).data('recencyWeight') as number

        // Oldest = 0, newest = 1, evenly spaced in between. The stylesheet maps this onto
        // width (2.5 → 10) and line-opacity (0.15 → 0.9).
        expect(weightOf('/project/n1.md')).toBe(0)
        expect(weightOf('/project/n2.md')).toBeCloseTo(0.5)
        expect(weightOf('/project/n3.md')).toBe(1)
    })

    it('a single authored node is treated as fully recent (weight 1)', () => {
        applyDeltaToUI(cy, deltaWith(makeNode(AGENT)))
        const shadowNodeId: string = getShadowNodeId(AGENT as TerminalId)
        expect(
            cy.getElementById(`terminal-progress-${shadowNodeId}->${NODE_ID}`).data('recencyWeight'),
        ).toBe(1)
    })
})
