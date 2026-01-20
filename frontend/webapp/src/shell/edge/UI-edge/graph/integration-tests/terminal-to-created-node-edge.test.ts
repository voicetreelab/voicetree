/**
 * Integration Test: Terminal to Created Node Edges
 *
 * BEHAVIOR TESTED:
 * When an agent creates a node with agent_name in YAML frontmatter,
 * a dotted edge should appear from the terminal shadow node to the new node.
 *
 * This provides visual feedback showing which terminal created which nodes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core, EdgeCollection } from 'cytoscape'
import cytoscape from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI'
import type { GraphNode, UpsertNodeDelta } from '@/pure/graph'
import { addTerminal, clearTerminals } from '@/shell/edge/UI-edge/state/TerminalStore'
import { createTerminalData, getShadowNodeId, getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types'
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/types'

// Mock engagement prompts to avoid jsdom's missing dialog.showModal()
vi.mock('@/shell/edge/UI-edge/graph/userEngagementPrompts', () => ({
    checkEngagementPrompts: vi.fn()
}))

function upsert(node: GraphNode): UpsertNodeDelta {
    return { type: 'UpsertNode', nodeToUpsert: node, previousNode: O.none }
}

describe('Terminal to created node edges', () => {
    let cy: Core

    beforeEach(() => {
        cy = cytoscape({
            headless: true,
            elements: []
        })
        clearTerminals()
    })

    afterEach(() => {
        cy.destroy()
        clearTerminals()
    })

    it('should create dotted edge from terminal shadow to new node with matching agent_name', () => {
        // GIVEN: A terminal with title "Sam: Some task"
        const terminal: TerminalData = createTerminalData({
            attachedToNodeId: 'context-node.md',
            terminalCount: 0,
            title: 'Sam: Some task',
        })
        addTerminal(terminal)

        // AND: A shadow node for the terminal exists in Cytoscape
        const shadowNodeId: string = getShadowNodeId(getTerminalId(terminal))
        cy.add({
            group: 'nodes',
            data: {
                id: shadowNodeId,
                isShadowNode: true,
                windowType: 'Terminal',
            },
            position: { x: 100, y: 100 }
        })

        // AND: A parent task node exists
        const parentNode: GraphNode = {
            absoluteFilePathIsID: 'task-node.md',
            contentWithoutYamlOrLinks: '# Task Node',
            outgoingEdges: [],
            nodeUIMetadata: {
                color: O.none,
                position: O.some({ x: 0, y: 0 }),
                additionalYAMLProps: new Map(),
                isContextNode: false
            }
        }
        applyGraphDeltaToUI(cy, [upsert(parentNode)])

        // WHEN: A new node is created with agent_name: Sam (matching terminal title prefix)
        const nodeCreatedByAgent: GraphNode = {
            absoluteFilePathIsID: 'progress-node.md',
            contentWithoutYamlOrLinks: '# Progress Report',
            outgoingEdges: [{ targetId: 'task-node.md', label: '' }],
            nodeUIMetadata: {
                color: O.some('blue'),
                position: O.some({ x: 200, y: 200 }),
                additionalYAMLProps: new Map([['agent_name', 'Sam']]),
                isContextNode: false
            }
        }
        applyGraphDeltaToUI(cy, [upsert(nodeCreatedByAgent)])

        // THEN: A dotted edge should exist from terminal shadow to the new node
        const progressEdges: EdgeCollection = cy.edges(`[source = "${shadowNodeId}"][target = "progress-node.md"]`)
        expect(progressEdges.length).toBe(1)

        // AND: The edge should have the terminal-progres-nodes-indicator class
        expect(progressEdges[0].hasClass('terminal-progres-nodes-indicator')).toBe(true)
    })

    it('should NOT create edge when agent_name does not match any terminal', () => {
        // GIVEN: A terminal with title "Victor: Some task"
        const terminal: TerminalData = createTerminalData({
            attachedToNodeId: 'context-node.md',
            terminalCount: 0,
            title: 'Victor: Some task',
        })
        addTerminal(terminal)

        // AND: A shadow node for the terminal exists in Cytoscape
        const shadowNodeId: string = getShadowNodeId(getTerminalId(terminal))
        cy.add({
            group: 'nodes',
            data: {
                id: shadowNodeId,
                isShadowNode: true,
                windowType: 'Terminal',
            },
            position: { x: 100, y: 100 }
        })

        // WHEN: A new node is created with agent_name: Sam (NOT matching terminal title)
        const nodeCreatedByDifferentAgent: GraphNode = {
            absoluteFilePathIsID: 'other-progress.md',
            contentWithoutYamlOrLinks: '# Other Progress',
            outgoingEdges: [],
            nodeUIMetadata: {
                color: O.some('green'),
                position: O.some({ x: 200, y: 200 }),
                additionalYAMLProps: new Map([['agent_name', 'Sam']]),
                isContextNode: false
            }
        }
        applyGraphDeltaToUI(cy, [upsert(nodeCreatedByDifferentAgent)])

        // THEN: No edge should exist from terminal shadow to the new node
        const progressEdges: EdgeCollection = cy.edges(`[source = "${shadowNodeId}"][target = "other-progress.md"]`)
        expect(progressEdges.length).toBe(0)
    })

    it('should NOT create edge when node has no agent_name', () => {
        // GIVEN: A terminal with title "Sam: Some task"
        const terminal: TerminalData = createTerminalData({
            attachedToNodeId: 'context-node.md',
            terminalCount: 0,
            title: 'Sam: Some task',
        })
        addTerminal(terminal)

        // AND: A shadow node for the terminal exists in Cytoscape
        const shadowNodeId: string = getShadowNodeId(getTerminalId(terminal))
        cy.add({
            group: 'nodes',
            data: {
                id: shadowNodeId,
                isShadowNode: true,
                windowType: 'Terminal',
            },
            position: { x: 100, y: 100 }
        })

        // WHEN: A new node is created WITHOUT agent_name
        const nodeWithoutAgentName: GraphNode = {
            absoluteFilePathIsID: 'manual-node.md',
            contentWithoutYamlOrLinks: '# Manual Node',
            outgoingEdges: [],
            nodeUIMetadata: {
                color: O.none,
                position: O.some({ x: 200, y: 200 }),
                additionalYAMLProps: new Map(),
                isContextNode: false
            }
        }
        applyGraphDeltaToUI(cy, [upsert(nodeWithoutAgentName)])

        // THEN: No edge should exist from terminal shadow to the new node
        const progressEdges: EdgeCollection = cy.edges(`[source = "${shadowNodeId}"][target = "manual-node.md"]`)
        expect(progressEdges.length).toBe(0)
    })
})
