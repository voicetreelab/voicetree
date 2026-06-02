// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import type { GraphNode } from '@vt/graph-model/graph'
import { syncProjectStateFromMain } from '@/shell/edge/UI-edge/state/stores/ProjectPathStore'
import {
    resetTestProjectionState,
    setTestCollapseSet,
    projectTestProjectionState,
} from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import { addTerminal, clearTerminals } from '@/shell/edge/UI-edge/state/stores/TerminalStore'
import { createTerminalData, getShadowNodeId, getTerminalId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import type { TerminalId, NodeIdAndFilePath } from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import { O, upsert, applyDeltaToUI, applySpecToUI, syncFolderTree } from './applyGraphDeltaToUI.test-utils'

vi.mock('@/shell/edge/UI-edge/graph/popups/userEngagementPrompts', () => ({
    checkEngagementPrompts: vi.fn(),
}))

// A node that lives inside the `internal` folder, plus the folder that contains
// it (folder ids carry a trailing slash by convention — see project-helpers).
const NODE_ID = '/project/auth/internal/refresh-token.md'
const FOLDER_ID = '/project/auth/internal/'
const TERMINAL_ID = `${NODE_ID}-terminal-0` as TerminalId

const ANCHOR_EDGE = 'edge.terminal-indicator'

function nodeInsideFolder(): GraphNode {
    return {
        absoluteFilePathIsID: NODE_ID,
        contentWithoutYamlOrLinks: '# Refresh Token',
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 200, y: 100 }),
            additionalYAMLProps: {},
            isContextNode: false,
        },
    }
}

/**
 * Regression: a terminal anchored to a node inside a folder must stay tethered
 * when that folder is collapsed.
 *
 * A terminal hangs off an invisible "shadow node" joined to its anchor node by a
 * structural `terminal-indicator` edge (the visible line; it also feeds Cola
 * layout). That edge is renderer-only — the projection never sees it. When the
 * folder collapses, the projection drops the anchored node, cytoscape cascades
 * away the node's edges (including the anchor edge), and the terminal is left
 * floating in empty space with no tether.
 *
 * The graph already reroutes *real* node→node edges onto the collapsed folder
 * (synthetic edges). The anchor edge must follow the same rule: re-point at the
 * visible collapsed-ancestor folder while the node is hidden, and back to the
 * node on expand.
 */
describe('applyGraphDeltaToUI — terminal anchor survives folder collapse', () => {
    let cy: Core
    const shadowNodeId: string = getShadowNodeId(TERMINAL_ID)

    function anchorEdgesIntoShadow(): cytoscape.EdgeCollection {
        return cy.getElementById(shadowNodeId).incomers(ANCHOR_EDGE)
    }

    beforeEach(() => {
        resetTestProjectionState()
        clearTerminals()
        cy = cytoscape({ headless: true, elements: [] })

        syncProjectStateFromMain({ readPaths: [], writeFolderPath: '/project', starredFolders: [] })
        syncFolderTree('/project')

        // A terminal anchored to the node inside the folder.
        addTerminal(createTerminalData({
            terminalId: TERMINAL_ID,
            attachedToNodeId: NODE_ID as NodeIdAndFilePath,
            anchoredToNodeId: NODE_ID as NodeIdAndFilePath,
            terminalCount: 0,
            title: 'agent',
            agentName: 'agent',
        }))

        // Project + render the node while the folder is expanded.
        setTestCollapseSet(new Set())
        applyDeltaToUI(cy, [upsert(nodeInsideFolder())])
        expect(cy.getElementById(NODE_ID).length).toBe(1)

        // Stand in for anchorToNode's output: the shadow node and the structural
        // anchor edge from the node to the shadow.
        cy.add({ group: 'nodes', data: { id: shadowNodeId, isShadowNode: true } })
        cy.add({
            group: 'edges',
            data: { id: `edge-${NODE_ID}-${shadowNodeId}`, source: NODE_ID, target: shadowNodeId },
            classes: 'terminal-indicator',
        })

        expect(anchorEdgesIntoShadow().length).toBe(1)
        expect(anchorEdgesIntoShadow()[0].data('source')).toBe(NODE_ID)
    })

    afterEach(() => {
        cy.destroy()
        clearTerminals()
        setTestCollapseSet(new Set())
        syncProjectStateFromMain({ readPaths: [], writeFolderPath: null, starredFolders: [] })
    })

    function collapseInternalFolder(): void {
        setTestCollapseSet(new Set([FOLDER_ID]))
        applySpecToUI(cy, projectTestProjectionState())
    }

    function expandInternalFolder(): void {
        setTestCollapseSet(new Set())
        applySpecToUI(cy, projectTestProjectionState())
    }

    it('reroutes the anchor edge onto the collapsed folder instead of orphaning it', () => {
        collapseInternalFolder()

        // The node is hidden and the folder is rendered as a collapsed proxy.
        expect(cy.getElementById(NODE_ID).length).toBe(0)
        expect(cy.getElementById(FOLDER_ID).length).toBe(1)

        // The shadow node (and thus the terminal window) survives...
        expect(cy.getElementById(shadowNodeId).length).toBe(1)

        // ...and stays tethered — to the collapsed folder, not floating in space.
        const anchors: cytoscape.EdgeCollection = anchorEdgesIntoShadow()
        expect(anchors.length).toBe(1)
        expect(anchors[0].data('source')).toBe(FOLDER_ID)
    })

    it('re-points the anchor edge back to the node when the folder expands', () => {
        collapseInternalFolder()
        expandInternalFolder()

        expect(cy.getElementById(NODE_ID).length).toBe(1)
        const anchors: cytoscape.EdgeCollection = anchorEdgesIntoShadow()
        expect(anchors.length).toBe(1)
        expect(anchors[0].data('source')).toBe(NODE_ID)
    })

    it('does not duplicate the anchor edge across repeated collapsed re-projections', () => {
        collapseInternalFolder()
        collapseInternalFolder()
        collapseInternalFolder()

        const anchors: cytoscape.EdgeCollection = anchorEdgesIntoShadow()
        expect(anchors.length).toBe(1)
        expect(anchors[0].data('source')).toBe(FOLDER_ID)
    })
})
