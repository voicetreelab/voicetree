import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import type { MockInstance } from 'vitest';

// Mock window event listeners before importing any modules
// This prevents mermaid from failing during module initialization
beforeAll(() => {
  if (!global.window.addEventListener) {
    global.window.addEventListener = vi.fn();
  }
  if (!global.window.removeEventListener) {
    global.window.removeEventListener = vi.fn();
  }
});

import { FloatingEditorManager } from '@/shell/UI/floating-windows/editors/FloatingEditorManager';
import cytoscape, { type Core } from 'cytoscape';
import '@/shell/UI/cytoscape-graph-ui'; // Import to trigger extension registration

describe('FloatingWindowManager - Terminal Node Filtering', () => {
    let manager: FloatingEditorManager;
    let cy: Core;
    let container: HTMLElement;
    let mockGetGraphState: ReturnType<typeof vi.fn>;
    let mockHotkeyManager: { onModifierChange: typeof vi.fn };

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

        // Mock cytoscape dimension methods for positioning calculations
        vi.spyOn(cy, 'width').mockReturnValue(800);
        vi.spyOn(cy, 'height').mockReturnValue(600);
        // @ts-expect-error - Mocking cytoscape methods for test
        vi.spyOn(cy, 'pan').mockReturnValue({ x: 0, y: 0 });
        // @ts-expect-error - Mocking cytoscape methods for test
        vi.spyOn(cy, 'zoom').mockReturnValue(1);

        // Mock dependencies
        mockGetGraphState = vi.fn(() => ({
            nodes: {},
            edges: {}
        })) as never;

        mockHotkeyManager = {
            onModifierChange: vi.fn()
        };

        // Create manager instance
        manager = new FloatingEditorManager(
            cy,
            mockGetGraphState,
            mockHotkeyManager as never
        );
    });

    afterEach(() => {
        // Cleanup
        manager.dispose();
        cy.destroy();
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }

        // Clean up any floating windows
        const windows: NodeListOf<Element> = document.querySelectorAll('.cy-floating-window');
        windows.forEach(win => win.remove());

        // Reset mocks
        vi.clearAllMocks();
    });

    describe('setupCommandHover - Terminal Node Filtering', () => {
        beforeEach(() => {
            // Setup command hover mode
            manager.setupCommandHover();
        });

        it('should NOT open hover editor for terminal nodes (nodes without file extension)', async () => {
            // Add a terminal node (no file extension)
            cy.add({
                group: 'nodes',
                data: { id: 'terminal-123' },
                position: { x: 100, y: 100 }
            });

            const terminalNode: cytoscape.CollectionReturnValue = cy.getElementById('terminal-123');

            // Simulate mouseover event
            terminalNode.emit('mouseover');

            // Wait for any async operations
            await new Promise(resolve => setTimeout(resolve, 150));

            // Hover editor should NOT be created for terminal node
            const hoverEditorWindows: NodeListOf<Element> = document.querySelectorAll('.cy-floating-window');
            expect(hoverEditorWindows.length).toBe(0);
        });

        it('should allow hover editor attempt for markdown nodes (nodes with .md extension)', async () => {
            // Spy on the private openHoverEditor method to verify it's called
            const openHoverEditorSpy: MockInstance<(this: unknown, ...args: unknown[]) => unknown> = vi.spyOn(manager as never, 'openHoverEditor' as never);

            // Add a markdown node (with .md extension)
            cy.add({
                group: 'nodes',
                data: { id: 'test-node.md' },
                position: { x: 200, y: 200 }
            });

            const markdownNode: cytoscape.CollectionReturnValue = cy.getElementById('test-node.md');

            // Simulate mouseover event
            markdownNode.emit('mouseover');

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 150));

            // openHoverEditor SHOULD be called for markdown nodes (filter doesn't block them)
            expect(openHoverEditorSpy).toHaveBeenCalled();
        });
    });
});
