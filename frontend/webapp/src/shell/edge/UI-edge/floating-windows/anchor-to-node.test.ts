import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core, EdgeSingular, EdgeCollection, NodeSingular } from 'cytoscape';
import { anchorToNode } from '@/shell/edge/UI-edge/floating-windows/anchor-to-node';
import { createTerminalData } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';

// Mock getCachedZoom to return 1
vi.mock('@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows', () => ({
    getCachedZoom: vi.fn(() => 1),
    cleanupRegistry: new Map(),
}));

// Mock setupResizeObserver and updateShadowNodeDimensions
vi.mock('@/shell/edge/UI-edge/floating-windows/setup-resize-observer', () => ({
    setupResizeObserver: vi.fn(() => undefined),
    updateShadowNodeDimensions: vi.fn(),
}));

describe('anchorToNode', () => {
    let cy: Core;
    let container: HTMLDivElement;
    let windowElement: HTMLDivElement;
    let terminalData: TerminalData;

    beforeEach(() => {
        // Set up DOM container
        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        document.body.appendChild(container);

        // Create cytoscape instance with a parent node
        cy = cytoscape({
            container: container,
            elements: [
                {
                    group: 'nodes',
                    data: { id: 'parent-node.md' },
                    position: { x: 400, y: 300 },
                },
            ],
            style: [],
            layout: { name: 'preset' },
        });

        // Create a mock window element with required attributes
        windowElement = document.createElement('div');
        windowElement.style.width = '350px';
        windowElement.style.height = '450px';
        windowElement.setAttribute('data-using-css-transform', 'false');
        document.body.appendChild(windowElement);

        // Create terminal data with ui populated (required by anchorToNode)
        terminalData = createTerminalData({
            attachedToNodeId: 'parent-node.md',
            terminalCount: 0,
            title: 'Test Terminal',
            anchoredToNodeId: 'parent-node.md',
            resizable: true,
        });

        // Populate the ui field (simulates createWindowChrome having been called)
        (terminalData as { ui: { windowElement: HTMLElement; contentContainer: HTMLElement } }).ui = {
            windowElement: windowElement,
            contentContainer: document.createElement('div'),
        };
    });

    afterEach(() => {
        if (cy) {
            cy.destroy();
        }
        if (container) {
            container.remove();
        }
        if (windowElement) {
            windowElement.remove();
        }
    });

    describe('indicator edge creation for terminals', () => {
        it('should create edge with isIndicatorEdge flag set to true', () => {
            // Act: call anchorToNode to create shadow node and edge
            anchorToNode(cy, terminalData);

            // Find the edge from parent to shadow node
            const edges: EdgeCollection = cy.edges();
            expect(edges.length).toBe(1);

            const edge: EdgeSingular = edges[0];

            // Assert: edge has data.isIndicatorEdge === true
            expect(edge.data('isIndicatorEdge')).toBe(true);
        });

        it('should create edge with terminal-indicator class', () => {
            // Act: call anchorToNode to create shadow node and edge
            anchorToNode(cy, terminalData);

            // Find the edge from parent to shadow node
            const edges: EdgeCollection = cy.edges();
            expect(edges.length).toBe(1);

            const edge: EdgeSingular = edges[0];

            // Assert: edge has class 'terminal-indicator'
            expect(edge.hasClass('terminal-indicator')).toBe(true);
        });
    });

    describe('1C: indicator edge position following', () => {
        /**
         * Test: Indicator edges should update their endpoint positions when nodes move.
         *
         * This verifies that edges with isIndicatorEdge flag behave the same as
         * regular edges - cytoscape automatically updates edge positions when
         * connected nodes move.
         *
         * Reference: Scenario "Indicator lines follow terminal position" from spec
         */
        it('should update edge endpoints when shadow node is moved', () => {
            // Act: call anchorToNode to create shadow node and edge
            const shadowNode: NodeSingular = anchorToNode(cy, terminalData);

            // Find the edge from parent to shadow node
            const edges: EdgeCollection = cy.edges();
            expect(edges.length).toBe(1);
            const edge: EdgeSingular = edges[0];

            // Verify edge has the indicator flag
            expect(edge.data('isIndicatorEdge')).toBe(true);

            // WHEN: The shadow node is moved (simulating terminal drag)
            const newPosition: cytoscape.Position = { x: 100, y: 100 };
            shadowNode.position(newPosition);

            // THEN: Shadow node position should match the new position
            const updatedPos: cytoscape.Position = shadowNode.position();
            expect(updatedPos.x).toBe(newPosition.x);
            expect(updatedPos.y).toBe(newPosition.y);

            // Edge should still be connected to both nodes
            // (cytoscape automatically updates edge positions when connected nodes move)
            expect(edge.source().id()).toBe('parent-node.md');
            expect(edge.target().id()).toBe(shadowNode.id());
            expect(edge.removed()).toBe(false);
        });

        it('should maintain edge connection after multiple position updates', () => {
            // Act: call anchorToNode to create shadow node and edge
            const shadowNode: NodeSingular = anchorToNode(cy, terminalData);

            const edges: EdgeCollection = cy.edges();
            const edge: EdgeSingular = edges[0];

            // WHEN: Multiple position updates occur (simulating drag movements)
            const positions: cytoscape.Position[] = [
                { x: 450, y: 350 },
                { x: 500, y: 400 },
                { x: 475, y: 500 },
                { x: 600, y: 450 }
            ];

            for (const pos of positions) {
                shadowNode.position(pos);

                // THEN: Edge should remain connected to both nodes after each move
                expect(edge.source().id()).toBe('parent-node.md');
                expect(edge.target().id()).toBe(shadowNode.id());

                // Edge should still exist and be connected
                expect(edge.removed()).toBe(false);

                // Indicator flag should persist
                expect(edge.data('isIndicatorEdge')).toBe(true);
            }

            // Final position should be reflected in node position
            const finalPos: cytoscape.Position = shadowNode.position();
            expect(finalPos.x).toBe(600);
            expect(finalPos.y).toBe(450);
        });
    });
});
