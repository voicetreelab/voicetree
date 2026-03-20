/**
 * Tests for traffic-lights.ts — specifically the fullscreen zoom button
 * for editors.
 *
 * BUG: createTrafficLightsForTarget for editor-window used getShadowNodeIdFromData()
 * which derives a shadow node ID ("nodeId-editor-anchor-shadowNode") that never exists
 * in Cytoscape. Anchored editors reuse the real node, hover editors use graphX/graphY.
 * The fullscreen button silently fails because cy.getElementById() returns empty.
 *
 * FIX: Use editor.contentLinkedToNodeId (the real node) as the zoom target,
 * matching the pattern already used by hover-menu traffic lights.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { createTrafficLightsForTarget } from './traffic-lights';
import { createEditorData, type EditorData } from './types';

// Mock cyFitIntoVisibleViewport — the function called when fullscreen zoom succeeds
const mockCyFit: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/utils/responsivePadding', () => ({
    cyFitIntoVisibleViewport: (...args: unknown[]) => mockCyFit(...args),
    getResponsivePadding: vi.fn(() => 20),
}));

vi.mock('@/utils/visibleViewport', () => ({
    getVisibleViewportMetrics: vi.fn(() => ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600 })),
}));

// Mock modules that traffic-lights.ts imports
vi.mock('@/shell/edge/UI-edge/state/EditorStore', () => ({
    isPinned: vi.fn(() => false),
    addToPinnedEditors: vi.fn(),
    removeFromPinnedEditors: vi.fn(),
    getEditorByNodeId: vi.fn(),
}));

vi.mock('@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD', () => ({
    closeHoverEditor: vi.fn(),
    createAnchoredFloatingEditor: vi.fn(),
}));

vi.mock('@/shell/edge/UI-edge/state/TerminalStore', () => ({
    getTerminal: vi.fn(),
}));

vi.mock('@/shell/UI/views/treeStyleTerminalTabs/terminalTabUtils', () => ({
    minimizeTerminal: vi.fn(),
    restoreTerminal: vi.fn(),
}));

vi.mock('@/shell/edge/UI-edge/floating-windows/image-viewers/FloatingImageViewerCRUD', () => ({
    closeHoverImageViewer: vi.fn(),
    createAnchoredFloatingImageViewer: vi.fn(),
}));

vi.mock('@/shell/edge/UI-edge/state/ImageViewerStore', () => ({
    getImageViewerByNodeId: vi.fn(),
}));

describe('traffic-lights fullscreen zoom for editors', () => {
    let cy: Core;
    let container: HTMLDivElement;
    const NODE_ID: string = 'test-node.md';

    beforeEach(() => {
        mockCyFit.mockClear();

        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        document.body.appendChild(container);

        cy = cytoscape({
            container,
            elements: [
                // Real node — the editor's contentLinkedToNodeId
                {
                    data: { id: NODE_ID },
                    position: { x: 200, y: 200 },
                },
            ],
            style: [],
            layout: { name: 'preset' },
        });
    });

    afterEach(() => {
        cy?.destroy();
        container?.remove();
    });

    it('should call cyFitIntoVisibleViewport when fullscreen button is clicked on editor', () => {
        const editor: EditorData = createEditorData({
            contentLinkedToNodeId: NODE_ID,
            title: 'Test Node',
            anchoredToNodeId: NODE_ID,
            resizable: true,
        });

        const trafficLightsContainer: HTMLDivElement = createTrafficLightsForTarget({
            kind: 'editor-window',
            editor,
            cy,
            closeEditor: vi.fn(),
        });

        const fullscreenBtn: HTMLButtonElement | null = trafficLightsContainer.querySelector('.traffic-light-fullscreen');
        expect(fullscreenBtn).not.toBeNull();

        // Click fullscreen button
        fullscreenBtn!.click();

        // cyFitIntoVisibleViewport should have been called (zoom to node)
        // If the bug is present (wrong shadow node ID), it returns early and this is never called
        expect(mockCyFit).toHaveBeenCalledTimes(1);
    });

    it('should target the real node, not the derived shadow node ID', () => {
        const editor: EditorData = createEditorData({
            contentLinkedToNodeId: NODE_ID,
            title: 'Test Node',
            anchoredToNodeId: NODE_ID,
            resizable: true,
        });

        // The derived shadow node ID doesn't exist in the graph
        const derivedShadowId: string = `${NODE_ID}-editor-anchor-shadowNode`;
        expect(cy.getElementById(derivedShadowId).length).toBe(0);
        expect(cy.getElementById(NODE_ID).length).toBe(1);

        const trafficLightsContainer: HTMLDivElement = createTrafficLightsForTarget({
            kind: 'editor-window',
            editor,
            cy,
            closeEditor: vi.fn(),
        });

        const fullscreenBtn: HTMLButtonElement | null = trafficLightsContainer.querySelector('.traffic-light-fullscreen');
        fullscreenBtn!.click();

        // Verify cyFitIntoVisibleViewport was called with the real node (collection containing NODE_ID)
        expect(mockCyFit).toHaveBeenCalledTimes(1);
        const [, targetCollection] = mockCyFit.mock.calls[0];
        expect(targetCollection.length).toBe(1);
        expect(targetCollection[0].id()).toBe(NODE_ID);
    });
});
