/**
 * Integration test for terminal placement collision detection with editor shadow nodes
 *
 * BEHAVIOR TESTED:
 * When a terminal is opened from a node that already has an editor pinned,
 * the terminal should NOT be placed at the same position as the editor.
 * It should detect the editor's shadow node and choose an alternate direction.
 *
 * BUG REGRESSION TEST:
 * Previously, updateNodeSizes() was being called on shadow nodes when edges were added,
 * which overwrote their dimensions from ~480x400 to ~15px (degree-based sizing).
 * This caused collision detection to fail because the editor shadow node appeared tiny.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import cytoscape from 'cytoscape'
import type { Core, NodeSingular, NodeCollection } from 'cytoscape'
import { StyleService } from '@/shell/UI/cytoscape-graph-ui/services/StyleService'

type BBox = { x1: number; x2: number; y1: number; y2: number }

/**
 * Helper to get bounding box from a node using position and dimensions
 * (More reliable in headless mode than node.boundingBox())
 */
function getNodeBBox(node: NodeSingular): BBox {
    const pos: cytoscape.Position = node.position()
    const w: number = node.width()
    const h: number = node.height()
    return {
        x1: pos.x - w / 2,
        x2: pos.x + w / 2,
        y1: pos.y - h / 2,
        y2: pos.y + h / 2
    }
}

describe('Terminal/Editor Collision Detection - Integration Tests', () => {
    let cy: Core
    let styleService: StyleService

    beforeEach(() => {
        // Create a Cytoscape instance
        cy = cytoscape({
            headless: true,
            elements: []
        })

        styleService = new StyleService()
    })

    afterEach(() => {
        cy.destroy()
    })

    describe('BEHAVIOR: Shadow node dimensions preserved during edge add events', () => {
        it('should detect collision with editor shadow node when placing terminal', () => {
            // GIVEN: A parent node at origin
            const parentNodeId: string = 'parent-node.md'
            const parentNode: NodeSingular = cy.add({
                group: 'nodes',
                data: { id: parentNodeId },
                position: { x: 0, y: 0 }
            })
            // Set parent to a small size
            parentNode.style({ 'width': 30, 'height': 30 })

            // AND: An editor shadow node to the RIGHT of the parent with proper dimensions
            const editorShadowId: string = 'shadow-editor-parent-node.md'
            const EDITOR_WIDTH: number = 480
            const EDITOR_HEIGHT: number = 400
            const GAP: number = 20

            // Position the editor shadow to the right, matching anchorToNode logic
            const editorX: number = 0 + (EDITOR_WIDTH / 2) + (30 / 2) + GAP // ~275
            const editorShadowNode: NodeSingular = cy.add({
                group: 'nodes',
                data: {
                    id: editorShadowId,
                    parentNodeId: parentNodeId,
                    isShadowNode: true,
                    windowType: 'Editor'
                },
                position: { x: editorX, y: 0 }
            })

            editorShadowNode.style({
                'width': EDITOR_WIDTH,
                'height': EDITOR_HEIGHT,
                'shape': 'rectangle'
            })

            // Add edge (triggers the bug scenario)
            cy.add({
                group: 'edges',
                data: {
                    id: `edge-${parentNodeId}-${editorShadowId}`,
                    source: parentNodeId,
                    target: editorShadowId
                }
            })

            // Simulate updateNodeSizes being called (this is what happens in the real app)
            const affectedNodes: NodeCollection = parentNode.union(editorShadowNode)
            styleService.updateNodeSizes(cy, affectedNodes)

            // WHEN: We check if a terminal placed to the right would collide
            const TERMINAL_WIDTH: number = 600
            const TERMINAL_HEIGHT: number = 400
            const terminalX: number = 0 + (TERMINAL_WIDTH / 2) + (30 / 2) + GAP // Same logic as editor

            // Create terminal bounding box (to the right of parent)
            const terminalBBox: BBox = {
                x1: terminalX - TERMINAL_WIDTH / 2,
                x2: terminalX + TERMINAL_WIDTH / 2,
                y1: 0 - TERMINAL_HEIGHT / 2,
                y2: 0 + TERMINAL_HEIGHT / 2
            }

            // Get editor shadow's bounding box using helper
            const editorBBox: BBox = getNodeBBox(editorShadowNode)

            // Check for overlap using AABB
            const hasOverlap: boolean =
                terminalBBox.x1 < editorBBox.x2 &&
                terminalBBox.x2 > editorBBox.x1 &&
                terminalBBox.y1 < editorBBox.y2 &&
                terminalBBox.y2 > editorBBox.y1

            // THEN: There SHOULD be a collision detected
            // The bug was: no collision because editor shadow was resized to ~15px
            // The fix: collision IS detected because editor shadow keeps 480x400 dimensions
            expect(hasOverlap).toBe(true)
        })

        it('REGRESSION: terminal should NOT be placed in same position as editor (the bug)', () => {
            // This test specifically verifies the end-to-end behavior:
            // When editor is to the right, terminal should NOT also go to the right

            // GIVEN: A parent node
            const parentNodeId: string = 'parent-node.md'
            const parentNode: NodeSingular = cy.add({
                group: 'nodes',
                data: { id: parentNodeId },
                position: { x: 0, y: 0 }
            })
            parentNode.style({ 'width': 30, 'height': 30 })

            // AND: An editor shadow node already placed to the right
            const EDITOR_WIDTH: number = 480
            const EDITOR_HEIGHT: number = 400
            const GAP: number = 20
            const editorX: number = (EDITOR_WIDTH / 2) + (30 / 2) + GAP

            const editorShadowNode: NodeSingular = cy.add({
                group: 'nodes',
                data: {
                    id: 'shadow-editor',
                    parentNodeId: parentNodeId,
                    isShadowNode: true,
                    windowType: 'Editor'
                },
                position: { x: editorX, y: 0 }
            })
            editorShadowNode.style({
                'width': EDITOR_WIDTH,
                'height': EDITOR_HEIGHT
            })

            // Add edge and call updateNodeSizes (simulating the real app behavior)
            cy.add({
                group: 'edges',
                data: { source: parentNodeId, target: 'shadow-editor' }
            })
            styleService.updateNodeSizes(cy, parentNode.union(editorShadowNode))

            // WHEN: We simulate the terminal placement algorithm
            const TERMINAL_WIDTH: number = 600
            const TERMINAL_HEIGHT: number = 400
            const parentPos: cytoscape.Position = parentNode.position()
            const parentWidth: number = parentNode.width()
            const parentHeight: number = parentNode.height()

            // Check each direction for available space (same logic as anchorToNode)
            const directions: Array<{ dx: number; dy: number; name: string }> = [
                { dx: 1, dy: 0, name: 'right' },
                { dx: -1, dy: 0, name: 'left' },
                { dx: 0, dy: 1, name: 'below' },
                { dx: 0, dy: -1, name: 'above' }
            ]

            const availableDirections: string[] = []

            for (const dir of directions) {
                const offsetX: number = dir.dx * ((TERMINAL_WIDTH / 2) + (parentWidth / 2) + GAP)
                const offsetY: number = dir.dy * ((TERMINAL_HEIGHT / 2) + (parentHeight / 2) + GAP)
                const candidatePos: { x: number; y: number } = {
                    x: parentPos.x + offsetX,
                    y: parentPos.y + offsetY
                }

                const terminalBBox: BBox = {
                    x1: candidatePos.x - TERMINAL_WIDTH / 2,
                    x2: candidatePos.x + TERMINAL_WIDTH / 2,
                    y1: candidatePos.y - TERMINAL_HEIGHT / 2,
                    y2: candidatePos.y + TERMINAL_HEIGHT / 2
                }

                // Check against all existing nodes using getNodeBBox helper
                let hasOverlap: boolean = false
                cy.nodes().forEach((node: NodeSingular) => {
                    if (node.id() === parentNodeId) return
                    const bb: BBox = getNodeBBox(node)
                    if (
                        terminalBBox.x1 < bb.x2 &&
                        terminalBBox.x2 > bb.x1 &&
                        terminalBBox.y1 < bb.y2 &&
                        terminalBBox.y2 > bb.y1
                    ) {
                        hasOverlap = true
                    }
                })

                if (!hasOverlap) {
                    availableDirections.push(dir.name)
                }
            }

            // THEN: "right" should NOT be available (editor is there)
            // The bug was: "right" was available because editor shadow appeared as 15px
            // The fix: "right" is blocked, other directions are available
            expect(availableDirections).not.toContain('right')
            expect(availableDirections.length).toBeGreaterThan(0) // At least one direction available
        })
    })
})
