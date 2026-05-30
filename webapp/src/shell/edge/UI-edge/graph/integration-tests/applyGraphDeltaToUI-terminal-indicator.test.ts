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
})
