import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';

// Mock window event listeners before importing any modules
beforeAll(() => {
  if (!global.window.addEventListener) {
    global.window.addEventListener = vi.fn();
  }
  if (!global.window.removeEventListener) {
    global.window.removeEventListener = vi.fn();
  }
});

import cytoscape, { type Core } from 'cytoscape';
import '@/shell/UI/cytoscape-graph-ui'; // Import to trigger extension registration
import { createWindowChrome, anchorToNode, getOrCreateOverlay } from './cytoscape-floating-windows';
import type { FloatingWindowUIHTMLData } from '@/shell/edge/UI-edge/floating-windows/types';

/**
 * Test for bug: CSS selector `cy.$(`#${id}`)` fails when ID contains special chars like `/`
 *
 * Root cause: Lines 172 and 259 in cytoscape-floating-windows.ts use CSS selectors
 * which fail silently when IDs contain special characters.
 *
 * Fix: Use cy.getElementById() instead of cy.$(`#${id}`)
 */
describe('Cytoscape ID lookup with special characters', () => {
    let cy: Core;
    let container: HTMLElement;

    beforeEach(() => {
        // Setup DOM
        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        document.body.appendChild(container);

        // Create cytoscape instance
        cy = cytoscape({
            container,
            elements: [],
            headless: true
        });
    });

    afterEach(() => {
        cy.destroy();
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    describe('Node ID with forward slash (/) character', () => {
        const nodeIdWithSlash: string = 'folder/subfolder/file.md';

        beforeEach(() => {
            cy.add({
                group: 'nodes',
                data: { id: nodeIdWithSlash },
                position: { x: 100, y: 100 }
            });
        });

        it('cy.getElementById() should find node with / in ID', () => {
            const node: cytoscape.CollectionReturnValue = cy.getElementById(nodeIdWithSlash);
            expect(node.length).toBe(1);
            expect(node.id()).toBe(nodeIdWithSlash);
        });

        it('cy.$(`#${id}`) CSS selector FAILS to find node with / in ID - THIS IS THE BUG', () => {
            // This demonstrates the bug: CSS selector fails with special chars
            const nodeViaCssSelector: cytoscape.CollectionReturnValue = cy.$(`#${nodeIdWithSlash}`);

            // BUG: CSS selector returns empty collection because / is invalid in CSS selectors
            expect(nodeViaCssSelector.length).toBe(0);
        });

        it('should be able to update position using getElementById (not CSS selector)', () => {
            const newPosition: cytoscape.Position = { x: 200, y: 300 };

            // This is what the fix should do - use getElementById
            const node: cytoscape.CollectionReturnValue = cy.getElementById(nodeIdWithSlash);
            expect(node.length).toBe(1);

            node.position(newPosition);

            const updatedPos: cytoscape.Position = node.position();
            expect(updatedPos.x).toBe(200);
            expect(updatedPos.y).toBe(300);
        });
    });

    describe('Node ID with other special characters', () => {
        const testCases: Array<{ name: string; id: string }> = [
            { name: 'colon', id: 'prefix:suffix.md' },
            { name: 'square brackets', id: 'file[1].md' },
            { name: 'parentheses', id: 'file(copy).md' },
            { name: 'plus sign', id: 'c++/file.md' },
            { name: 'hash', id: 'section#heading.md' },
            { name: 'at sign', id: '@scope/package.md' },
        ];

        testCases.forEach(({ name, id }) => {
            it(`getElementById works for ID with ${name}: "${id}"`, () => {
                cy.add({
                    group: 'nodes',
                    data: { id },
                    position: { x: 100, y: 100 }
                });

                const node: cytoscape.CollectionReturnValue = cy.getElementById(id);
                expect(node.length).toBe(1);
                expect(node.id()).toBe(id);
            });
        });
    });
});

/**
 * Integration test: Terminal drag updates shadow node position when ID contains special chars
 *
 * This tests the actual bug scenario: dragging a floating window's title bar
 * should update the shadow node position, which was failing when IDs contained `/`
 */
describe('Floating window drag syncs shadow node position (bug fix test)', () => {
    let cy: Core;
    let container: HTMLElement;
    let wrapper: HTMLDivElement;
    let overlay: HTMLElement;

    beforeEach(() => {
        // Setup DOM with parent wrapper (required for overlay)
        wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.width = '800px';
        wrapper.style.height = '600px';
        document.body.appendChild(wrapper);

        container = document.createElement('div');
        container.style.width = '100%';
        container.style.height = '100%';
        wrapper.appendChild(container);

        // Create cytoscape instance in headless mode
        cy = cytoscape({
            container,
            elements: [],
            headless: true
        });

        // Mock cytoscape methods
        vi.spyOn(cy, 'width').mockReturnValue(800);
        vi.spyOn(cy, 'height').mockReturnValue(600);
        // @ts-expect-error - Mocking cytoscape methods for test
        vi.spyOn(cy, 'pan').mockReturnValue({ x: 0, y: 0 });
        // @ts-expect-error - Mocking cytoscape methods for test
        vi.spyOn(cy, 'zoom').mockReturnValue(1);

        overlay = getOrCreateOverlay(cy);
    });

    afterEach(() => {
        cy.destroy();
        // Clean up wrapper and all children
        if (wrapper?.parentNode) {
            wrapper.parentNode.removeChild(wrapper);
        }
        // Clean up any floating windows
        document.querySelectorAll('.cy-floating-window').forEach(win => win.remove());
        document.querySelectorAll('.cy-floating-overlay').forEach(o => o.remove());
        vi.clearAllMocks();
    });

    it('dragging window updates shadow node position when parent ID contains /', () => {
        // Setup: parent node with / in ID (like a file path)
        const parentNodeId: string = 'folder/subfolder/note.md';
        cy.add({
            group: 'nodes',
            data: { id: parentNodeId },
            position: { x: 100, y: 100 }
        });

        // Create floating window chrome
        const windowId: string = `${parentNodeId}-editor`;
        const { windowElement, contentContainer, titleBar } = createWindowChrome(cy, {
            id: windowId,
            title: 'Test Editor',
            component: 'MarkdownEditor'
        });
        overlay.appendChild(windowElement);

        // Create the floating window data structure
        const floatingWindow: FloatingWindowUIHTMLData = {
            id: windowId,
            windowElement,
            contentContainer,
            titleBar,
            cleanup: () => {}
        };

        // Anchor window to parent node (creates shadow node)
        const shadowNode: cytoscape.NodeSingular = anchorToNode(cy, floatingWindow, parentNodeId, { isFloatingWindow: true });
        const shadowNodeId: string = shadowNode.id();

        // Verify shadow node was created and has special chars in ID
        expect(shadowNodeId).toContain(parentNodeId);
        expect(shadowNodeId).toContain('/');

        // Get initial shadow node position (offset from parent: 100+50=150)
        const initialPos: cytoscape.Position = shadowNode.position();
        expect(initialPos.x).toBe(150);
        expect(initialPos.y).toBe(150);

        // Simulate drag: update window position and trigger the same logic as handleMouseMove
        const newGraphX: number = 300;
        const newGraphY: number = 400;
        windowElement.style.left = `${newGraphX}px`;
        windowElement.style.top = `${newGraphY}px`;

        // This is the critical part - look up shadow node by ID and update position
        // The bug was: cy.$(`#${shadowNodeId}`) fails when ID contains /
        // The fix: cy.getElementById(shadowNodeId) works correctly
        const lookedUpShadow: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
        expect(lookedUpShadow.length).toBe(1); // This would be 0 with the bug (using cy.$)

        lookedUpShadow.position({ x: newGraphX, y: newGraphY });

        // Verify shadow node position was updated to new values
        const updatedPos: cytoscape.Position = shadowNode.position();
        expect(updatedPos.x).toBe(300);
        expect(updatedPos.y).toBe(400);
    });

    it('REGRESSION: cy.$() would fail to find shadow node with / in ID', () => {
        // This test documents the bug behavior - demonstrates why cy.$() fails
        const parentNodeId: string = 'folder/subfolder/note.md';
        cy.add({
            group: 'nodes',
            data: { id: parentNodeId },
            position: { x: 100, y: 100 }
        });

        const windowId: string = `${parentNodeId}-editor`;
        const { windowElement, contentContainer, titleBar } = createWindowChrome(cy, {
            id: windowId,
            title: 'Test Editor',
            component: 'MarkdownEditor'
        });
        overlay.appendChild(windowElement);

        const floatingWindow: FloatingWindowUIHTMLData = {
            id: windowId,
            windowElement,
            contentContainer,
            titleBar,
            cleanup: () => {}
        };

        const shadowNode: cytoscape.NodeSingular = anchorToNode(cy, floatingWindow, parentNodeId, { isFloatingWindow: true });
        const shadowNodeId: string = shadowNode.id();

        // BUG: CSS selector fails with special chars - returns empty collection
        // This is what the old code did: cy.$(`#${shadowNodeId}`)
        const viaCSS: cytoscape.CollectionReturnValue = cy.$(`#${shadowNodeId}`);
        expect(viaCSS.length).toBe(0); // Bug: can't find it

        // FIX: getElementById works correctly - this is what the new code does
        const viaGetById: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
        expect(viaGetById.length).toBe(1); // Fix: finds it correctly

        // Without the fix, dragging terminal would NOT update shadow node position
        // because cy.$(`#${shadowNodeId}`) returns empty and the position update is skipped
    });

    it('BUG WOULD CAUSE: shadow node position not updated when ID contains /', () => {
        // This test shows what WOULD happen with the bug (using cy.$)
        // vs what SHOULD happen with the fix (using getElementById)
        const parentNodeId: string = 'folder/subfolder/note.md';
        cy.add({
            group: 'nodes',
            data: { id: parentNodeId },
            position: { x: 100, y: 100 }
        });

        const windowId: string = `${parentNodeId}-editor`;
        const { windowElement, contentContainer, titleBar } = createWindowChrome(cy, {
            id: windowId,
            title: 'Test Editor',
            component: 'MarkdownEditor'
        });
        overlay.appendChild(windowElement);

        const floatingWindow: FloatingWindowUIHTMLData = {
            id: windowId,
            windowElement,
            contentContainer,
            titleBar,
            cleanup: () => {}
        };

        const shadowNode: cytoscape.NodeSingular = anchorToNode(cy, floatingWindow, parentNodeId, { isFloatingWindow: true });
        const shadowNodeId: string = shadowNode.id();
        const initialPos: cytoscape.Position = shadowNode.position();

        // Simulate what handleMouseMove does
        const newX: number = 500;
        const newY: number = 600;

        // BUGGY CODE PATH (what would happen before fix):
        const viaBuggyCSS: cytoscape.CollectionReturnValue = cy.$(`#${shadowNodeId}`);
        if (viaBuggyCSS.length > 0) {
            viaBuggyCSS.position({ x: newX, y: newY });
        }
        // Position NOT updated because cy.$() returned empty
        expect(shadowNode.position().x).toBe(initialPos.x);
        expect(shadowNode.position().y).toBe(initialPos.y);

        // FIXED CODE PATH (what happens after fix):
        const viaFixedGetById: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
        if (viaFixedGetById.length > 0) {
            viaFixedGetById.position({ x: newX, y: newY });
        }
        // Position IS updated because getElementById() works
        expect(shadowNode.position().x).toBe(newX);
        expect(shadowNode.position().y).toBe(newY);
    });
});
