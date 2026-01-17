import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { createWindowChrome } from '@/shell/edge/UI-edge/floating-windows/create-window-chrome';
import { createEditorData, createTerminalData, type EditorData, type TerminalData, type EditorId, type TerminalId, type FloatingWindowUIData } from '@/shell/edge/UI-edge/floating-windows/types';

// Mock getCachedZoom to return 1
vi.mock('@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows', () => ({
    getCachedZoom: vi.fn(() => 1),
    captureTerminalScrollPositions: vi.fn(),
}));

// Mock HorizontalMenuService
vi.mock('@/shell/UI/cytoscape-graph-ui/services/HorizontalMenuService', () => ({
    getNodeMenuItems: vi.fn(() => []),
    createHorizontalMenuElement: vi.fn(() => ({
        leftGroup: document.createElement('div'),
        rightGroup: document.createElement('div'),
    })),
}));

// Mock EditorStore
vi.mock('@/shell/edge/UI-edge/state/EditorStore', () => ({
    isPinned: vi.fn(() => false),
    addToPinnedEditors: vi.fn(),
    removeFromPinnedEditors: vi.fn(),
    addToAutoPinQueue: vi.fn(),
    removeFromAutoPinQueue: vi.fn(),
}));

// Mock FloatingEditorCRUD
vi.mock('@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD', () => ({
    createAnchoredFloatingEditor: vi.fn(),
    closeHoverEditor: vi.fn(),
}));

describe('createWindowChrome', () => {
    let cy: Core;
    let container: HTMLDivElement;
    let editorData: EditorData;
    const editorId: EditorId = 'test-node.md-editor' as EditorId;

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        document.body.appendChild(container);

        cy = cytoscape({
            container: container,
            elements: [],
            style: [],
            layout: { name: 'preset' },
        });

        editorData = createEditorData({
            contentLinkedToNodeId: 'test-node.md',
            title: 'Test Node',
            anchoredToNodeId: undefined,
            resizable: true,
        });
    });

    afterEach(() => {
        if (cy) {
            cy.destroy();
        }
        if (container) {
            container.remove();
        }
    });

    describe('Phase 1: No window chrome bar', () => {
        it('should NOT return a titleBar property', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            // Phase 1: titleBar should not be in the return type
            expect(result).not.toHaveProperty('titleBar');
        });

        it('should return windowElement and contentContainer only', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            expect(result).toHaveProperty('windowElement');
            expect(result).toHaveProperty('contentContainer');
            expect(result.windowElement).toBeInstanceOf(HTMLElement);
            expect(result.contentContainer).toBeInstanceOf(HTMLElement);
        });

        it('should NOT have a .cy-floating-window-title child element', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            const titleBar: Element | null = result.windowElement.querySelector('.cy-floating-window-title');
            expect(titleBar).toBeNull();
        });

        it('should NOT have .macos-traffic-lights button container', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            const trafficLights: Element | null = result.windowElement.querySelector('.macos-traffic-lights');
            expect(trafficLights).toBeNull();
        });

        it('should NOT have close/expand/fullscreen/pin buttons in title bar', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            // These buttons should not exist in the current Phase 1 implementation
            // (they will be moved to horizontal menu in Phase 2A/3)
            const closeBtn: Element | null = result.windowElement.querySelector('.cy-floating-window-close');
            const expandBtn: Element | null = result.windowElement.querySelector('.cy-floating-window-expand');
            const fullscreenBtn: Element | null = result.windowElement.querySelector('.cy-floating-window-fullscreen');
            const pinBtn: Element | null = result.windowElement.querySelector('.cy-floating-window-pin');

            expect(closeBtn).toBeNull();
            expect(expandBtn).toBeNull();
            expect(fullscreenBtn).toBeNull();
            expect(pinBtn).toBeNull();
        });

        it('should have content container as direct child of window element', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            // Content container should be a direct child
            const children: Element[] = Array.from(result.windowElement.children);
            expect(children).toContain(result.contentContainer);
        });
    });

    describe('Phase 2B: Bottom-right expand button', () => {
        it('should have expand button in bottom-right corner of window', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            const expandBtn: HTMLElement | null = result.windowElement.querySelector('.cy-floating-window-expand-corner');
            expect(expandBtn).not.toBeNull();
            expect(expandBtn).toBeInstanceOf(HTMLElement);

            // Verify button is positioned in bottom-right via inline styles (flush with edge)
            if (expandBtn) {
                expect(expandBtn.style.position).toBe('absolute');
                expect(expandBtn.style.bottom).toBe('0px');
                expect(expandBtn.style.right).toBe('0px');
            }
        });

        it('should have Maximize2 icon initially (not expanded)', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            const expandBtn: HTMLElement | null = result.windowElement.querySelector('.cy-floating-window-expand-corner');
            expect(expandBtn).not.toBeNull();

            // Should have an SVG child (Maximize2 icon)
            const svgIcon: SVGElement | null = expandBtn?.querySelector('svg') ?? null;
            expect(svgIcon).not.toBeNull();

            // Window should not be in expanded state initially
            expect(result.windowElement.dataset.expanded).not.toBe('true');
        });

        it('should expand window to 2x dimensions on click', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            const expandBtn: HTMLElement | null = result.windowElement.querySelector('.cy-floating-window-expand-corner');
            expect(expandBtn).not.toBeNull();

            // Get initial dimensions from base dimensions
            const baseWidth: number = parseInt(result.windowElement.dataset.baseWidth ?? '0', 10);
            const baseHeight: number = parseInt(result.windowElement.dataset.baseHeight ?? '0', 10);
            expect(baseWidth).toBeGreaterThan(0);
            expect(baseHeight).toBeGreaterThan(0);

            // Click to expand
            expandBtn?.click();

            // Window should now be in expanded state
            expect(result.windowElement.dataset.expanded).toBe('true');

            // Dimensions should be 2x base
            const expandedWidth: number = parseInt(result.windowElement.style.width, 10);
            const expandedHeight: number = parseInt(result.windowElement.style.height, 10);
            expect(expandedWidth).toBe(baseWidth * 2);
            expect(expandedHeight).toBe(baseHeight * 2);
        });

        it('should shrink window to 0.5x (back to base) on second click', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            const expandBtn: HTMLElement | null = result.windowElement.querySelector('.cy-floating-window-expand-corner');
            expect(expandBtn).not.toBeNull();

            const baseWidth: number = parseInt(result.windowElement.dataset.baseWidth ?? '0', 10);
            const baseHeight: number = parseInt(result.windowElement.dataset.baseHeight ?? '0', 10);

            // First click: expand to 2x
            expandBtn?.click();
            expect(result.windowElement.dataset.expanded).toBe('true');

            // Second click: shrink back (0.5x of expanded = original base)
            expandBtn?.click();
            expect(result.windowElement.dataset.expanded).toBe('false');

            // Dimensions should be back to base
            const currentWidth: number = parseInt(result.windowElement.style.width, 10);
            const currentHeight: number = parseInt(result.windowElement.style.height, 10);
            expect(currentWidth).toBe(baseWidth);
            expect(currentHeight).toBe(baseHeight);
        });

        it('should toggle icon between Maximize2 and Minimize2 based on state', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            const expandBtn: HTMLElement | null = result.windowElement.querySelector('.cy-floating-window-expand-corner');
            expect(expandBtn).not.toBeNull();

            // Initial state: should show expand icon (data-icon attribute)
            expect(expandBtn?.dataset.icon).toBe('maximize');

            // Click to expand
            expandBtn?.click();

            // Expanded state: should show minimize icon
            expect(expandBtn?.dataset.icon).toBe('minimize');

            // Click to minimize
            expandBtn?.click();

            // Back to maximize icon
            expect(expandBtn?.dataset.icon).toBe('maximize');
        });

        it('should be visually distinct from resize handles (button element)', () => {
            const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

            const expandBtn: HTMLElement | null = result.windowElement.querySelector('.cy-floating-window-expand-corner');
            expect(expandBtn).not.toBeNull();

            // Should be a button element, not a generic div
            expect(expandBtn?.tagName.toLowerCase()).toBe('button');
        });
    });

    describe('Phase 2C: macOS-Style Edge Resizing', () => {
        describe('Resize zone elements', () => {
            it('should have resize zones on all 4 edges for resizable windows', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const topZone: Element | null = result.windowElement.querySelector('.resize-zone-top');
                const bottomZone: Element | null = result.windowElement.querySelector('.resize-zone-bottom');
                const leftZone: Element | null = result.windowElement.querySelector('.resize-zone-left');
                const rightZone: Element | null = result.windowElement.querySelector('.resize-zone-right');

                expect(topZone).not.toBeNull();
                expect(bottomZone).not.toBeNull();
                expect(leftZone).not.toBeNull();
                expect(rightZone).not.toBeNull();
            });

            it('should have resize zones on all 4 corners for resizable windows', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const nwCorner: Element | null = result.windowElement.querySelector('.resize-zone-corner-nw');
                const neCorner: Element | null = result.windowElement.querySelector('.resize-zone-corner-ne');
                const swCorner: Element | null = result.windowElement.querySelector('.resize-zone-corner-sw');
                const seCorner: Element | null = result.windowElement.querySelector('.resize-zone-corner-se');

                expect(nwCorner).not.toBeNull();
                expect(neCorner).not.toBeNull();
                expect(swCorner).not.toBeNull();
                expect(seCorner).not.toBeNull();
            });

            it('should NOT have resize zones for non-resizable windows', () => {
                const nonResizableEditor: EditorData = createEditorData({
                    contentLinkedToNodeId: 'test-node.md',
                    title: 'Test Node',
                    anchoredToNodeId: undefined,
                    resizable: false,
                });

                const result: FloatingWindowUIData = createWindowChrome(cy, nonResizableEditor, editorId);

                const resizeZones: NodeListOf<Element> = result.windowElement.querySelectorAll('[class*="resize-zone"]');
                expect(resizeZones.length).toBe(0);
            });

            it('should have resize zones with 4-6px width/height', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                // Append to document to get computed styles
                document.body.appendChild(result.windowElement);

                const topZone: HTMLElement | null = result.windowElement.querySelector('.resize-zone-top');
                const leftZone: HTMLElement | null = result.windowElement.querySelector('.resize-zone-left');

                expect(topZone).not.toBeNull();
                expect(leftZone).not.toBeNull();

                // The zones should exist with proper dimensions set via style
                // Note: JSDOM doesn't compute actual styles, so we check the style properties
                expect(topZone!.style.height).toMatch(/^[4-6]px$/);
                expect(leftZone!.style.width).toMatch(/^[4-6]px$/);

                document.body.removeChild(result.windowElement);
            });
        });

        describe('Cursor styles', () => {
            it('should have ns-resize cursor on top edge zone', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const topZone: HTMLElement | null = result.windowElement.querySelector('.resize-zone-top');
                expect(topZone).not.toBeNull();
                expect(topZone!.style.cursor).toBe('ns-resize');
            });

            it('should have ns-resize cursor on bottom edge zone', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const bottomZone: HTMLElement | null = result.windowElement.querySelector('.resize-zone-bottom');
                expect(bottomZone).not.toBeNull();
                expect(bottomZone!.style.cursor).toBe('ns-resize');
            });

            it('should have ew-resize cursor on left edge zone', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const leftZone: HTMLElement | null = result.windowElement.querySelector('.resize-zone-left');
                expect(leftZone).not.toBeNull();
                expect(leftZone!.style.cursor).toBe('ew-resize');
            });

            it('should have ew-resize cursor on right edge zone', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const rightZone: HTMLElement | null = result.windowElement.querySelector('.resize-zone-right');
                expect(rightZone).not.toBeNull();
                expect(rightZone!.style.cursor).toBe('ew-resize');
            });

            it('should have nwse-resize cursor on NW corner zone', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const nwCorner: HTMLElement | null = result.windowElement.querySelector('.resize-zone-corner-nw');
                expect(nwCorner).not.toBeNull();
                expect(nwCorner!.style.cursor).toBe('nwse-resize');
            });

            it('should have nwse-resize cursor on SE corner zone', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const seCorner: HTMLElement | null = result.windowElement.querySelector('.resize-zone-corner-se');
                expect(seCorner).not.toBeNull();
                expect(seCorner!.style.cursor).toBe('nwse-resize');
            });

            it('should have nesw-resize cursor on NE corner zone', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const neCorner: HTMLElement | null = result.windowElement.querySelector('.resize-zone-corner-ne');
                expect(neCorner).not.toBeNull();
                expect(neCorner!.style.cursor).toBe('nesw-resize');
            });

            it('should have nesw-resize cursor on SW corner zone', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const swCorner: HTMLElement | null = result.windowElement.querySelector('.resize-zone-corner-sw');
                expect(swCorner).not.toBeNull();
                expect(swCorner!.style.cursor).toBe('nesw-resize');
            });
        });

        describe('Resize zone positioning', () => {
            it('should position top zone at the top edge', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const topZone: HTMLElement | null = result.windowElement.querySelector('.resize-zone-top');
                expect(topZone).not.toBeNull();
                expect(topZone!.style.top).toBe('0px');
                expect(topZone!.style.left).toBe('0px');
                expect(topZone!.style.right).toBe('0px');
            });

            it('should position bottom zone at the bottom edge', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const bottomZone: HTMLElement | null = result.windowElement.querySelector('.resize-zone-bottom');
                expect(bottomZone).not.toBeNull();
                expect(bottomZone!.style.bottom).toBe('0px');
                expect(bottomZone!.style.left).toBe('0px');
                expect(bottomZone!.style.right).toBe('0px');
            });

            it('should position left zone at the left edge', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const leftZone: HTMLElement | null = result.windowElement.querySelector('.resize-zone-left');
                expect(leftZone).not.toBeNull();
                expect(leftZone!.style.left).toBe('0px');
                expect(leftZone!.style.top).toBe('0px');
                expect(leftZone!.style.bottom).toBe('0px');
            });

            it('should position right zone at the right edge', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const rightZone: HTMLElement | null = result.windowElement.querySelector('.resize-zone-right');
                expect(rightZone).not.toBeNull();
                expect(rightZone!.style.right).toBe('0px');
                expect(rightZone!.style.top).toBe('0px');
                expect(rightZone!.style.bottom).toBe('0px');
            });
        });

        describe('Resize zone visibility', () => {
            it('should have transparent background on resize zones (invisible)', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

                const zones: NodeListOf<HTMLElement> = result.windowElement.querySelectorAll('[class*="resize-zone"]');
                expect(zones.length).toBeGreaterThan(0);

                zones.forEach((zone: HTMLElement) => {
                    // Background should be transparent or not set (defaults to transparent)
                    expect(zone.style.background === '' || zone.style.background === 'transparent').toBe(true);
                });
            });
        });
    });

    describe('Phase 4: Terminal Window Chrome', () => {
        let terminalData: TerminalData;
        const terminalId: TerminalId = 'ctx-nodes/test-context.md-terminal-0' as TerminalId;

        beforeEach(() => {
            // Plain terminal (no context node - attached to regular node)
            terminalData = createTerminalData({
                attachedToNodeId: 'test-node.md',
                terminalCount: 0,
                title: 'Test Terminal',
                anchoredToNodeId: 'test-node.md',
                resizable: true,
            });
        });

        describe('Terminal has no horizontal menu', () => {
            it('should NOT have horizontal menu wrapper for terminals', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

                const horizontalMenu: Element | null = result.windowElement.querySelector('.cy-floating-window-horizontal-menu');
                expect(horizontalMenu).toBeNull();
            });

            it('should NOT have left group (Delete/Copy/Add buttons) for terminals', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

                const leftGroup: Element | null = result.windowElement.querySelector('.horizontal-menu-left-group');
                expect(leftGroup).toBeNull();
            });

            it('should NOT have right group with Run/More buttons for terminals', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

                // Right group should only have traffic lights, no horizontal-menu-pill with Run/More
                const rightGroupPill: Element | null = result.windowElement.querySelector('.horizontal-menu-pill.horizontal-menu-right-group');
                expect(rightGroupPill).toBeNull();
            });
        });

        describe('Terminal traffic lights at far right', () => {
            it('should have terminal title bar with traffic lights', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

                const titleBar: Element | null = result.windowElement.querySelector('.terminal-title-bar');
                expect(titleBar).not.toBeNull();
            });

            it('should have traffic light container positioned at far right', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

                const trafficLights: HTMLElement | null = result.windowElement.querySelector('.terminal-traffic-lights');
                expect(trafficLights).not.toBeNull();

                // Should be positioned at far right with ~10px padding
                expect(trafficLights!.style.right).toMatch(/^(8|10|12)px$/);
            });

            it('should have Close, Pin, and Fullscreen traffic light buttons', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

                const closeBtn: Element | null = result.windowElement.querySelector('.traffic-light-close');
                const pinBtn: Element | null = result.windowElement.querySelector('.traffic-light-pin');
                const fullscreenBtn: Element | null = result.windowElement.querySelector('.traffic-light-fullscreen');

                expect(closeBtn).not.toBeNull();
                expect(pinBtn).not.toBeNull();
                expect(fullscreenBtn).not.toBeNull();
            });

            it('should dispatch traffic-light-close event when Close button clicked', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

                const closeBtn: HTMLElement | null = result.windowElement.querySelector('.traffic-light-close');
                expect(closeBtn).not.toBeNull();

                // Listen for the custom event
                let eventFired: boolean = false;
                result.windowElement.addEventListener('traffic-light-close', () => {
                    eventFired = true;
                });

                closeBtn!.click();
                expect(eventFired).toBe(true);
            });
        });

        describe('Terminal with context node shows context badge', () => {
            let contextTerminalData: TerminalData;
            const contextTerminalId: TerminalId = 'ctx-nodes/parent-node_context_1.md-terminal-0' as TerminalId;

            beforeEach(() => {
                // Terminal with context node (has .context_node. or _context_ in path)
                contextTerminalData = createTerminalData({
                    attachedToNodeId: 'ctx-nodes/parent-node_context_1.md',
                    terminalCount: 0,
                    title: 'Context Terminal',
                    anchoredToNodeId: 'ctx-nodes/parent-node_context_1.md',
                    resizable: true,
                });
            });

            it('should have context badge for terminals with context node', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, contextTerminalData, contextTerminalId);

                const contextBadge: Element | null = result.windowElement.querySelector('.terminal-context-badge');
                expect(contextBadge).not.toBeNull();
            });

            it('should have clipboard icon in context badge', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, contextTerminalData, contextTerminalId);

                const contextBadge: Element | null = result.windowElement.querySelector('.terminal-context-badge');
                expect(contextBadge).not.toBeNull();

                const icon: Element | null = contextBadge!.querySelector('svg');
                expect(icon).not.toBeNull();
            });

            it('should show truncated title in context badge (max 20 chars)', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, contextTerminalData, contextTerminalId);

                const badgeTitle: HTMLElement | null = result.windowElement.querySelector('.terminal-context-badge-title');
                expect(badgeTitle).not.toBeNull();

                // Title should be truncated if longer than 20 chars
                const titleText: string = badgeTitle!.textContent ?? '';
                expect(titleText.length).toBeLessThanOrEqual(23); // 20 chars + "..." if truncated
            });
        });

        describe('Context badge expands on click', () => {
            let contextTerminalData: TerminalData;
            const contextTerminalId: TerminalId = 'ctx-nodes/parent-node_context_1.md-terminal-0' as TerminalId;

            beforeEach(() => {
                contextTerminalData = createTerminalData({
                    attachedToNodeId: 'ctx-nodes/parent-node_context_1.md',
                    terminalCount: 0,
                    title: 'Context Terminal',
                    anchoredToNodeId: 'ctx-nodes/parent-node_context_1.md',
                    resizable: true,
                });
            });

            it('should toggle terminal-context-expanded class on click', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, contextTerminalData, contextTerminalId);

                const contextBadge: HTMLElement | null = result.windowElement.querySelector('.terminal-context-badge');
                expect(contextBadge).not.toBeNull();

                // Initially not expanded
                expect(result.windowElement.classList.contains('terminal-context-expanded')).toBe(false);

                // Click to expand
                contextBadge!.click();
                expect(result.windowElement.classList.contains('terminal-context-expanded')).toBe(true);

                // Click again to collapse
                contextBadge!.click();
                expect(result.windowElement.classList.contains('terminal-context-expanded')).toBe(false);
            });
        });

        describe('Plain terminal has no context badge', () => {
            it('should NOT have context badge for plain terminals (non-context node)', () => {
                // terminalData is attached to 'test-node.md' - not a context node
                const result: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

                const contextBadge: Element | null = result.windowElement.querySelector('.terminal-context-badge');
                expect(contextBadge).toBeNull();
            });

            it('should identify context nodes by ctx-nodes/ prefix or _context_ in path', () => {
                // Test with node that has ctx-nodes/ prefix
                const ctxPrefixTerminal: TerminalData = createTerminalData({
                    attachedToNodeId: 'ctx-nodes/some-task.md',
                    terminalCount: 0,
                    title: 'Ctx Prefix Terminal',
                    anchoredToNodeId: 'ctx-nodes/some-task.md',
                    resizable: true,
                });
                const result1: FloatingWindowUIData = createWindowChrome(cy, ctxPrefixTerminal, 'ctx-nodes/some-task.md-terminal-0' as TerminalId);
                expect(result1.windowElement.querySelector('.terminal-context-badge')).not.toBeNull();

                // Test with node that has _context_ in name
                const contextInNameTerminal: TerminalData = createTerminalData({
                    attachedToNodeId: 'folder/task_context_1.md',
                    terminalCount: 0,
                    title: 'Context In Name Terminal',
                    anchoredToNodeId: 'folder/task_context_1.md',
                    resizable: true,
                });
                const result2: FloatingWindowUIData = createWindowChrome(cy, contextInNameTerminal, 'folder/task_context_1.md-terminal-0' as TerminalId);
                expect(result2.windowElement.querySelector('.terminal-context-badge')).not.toBeNull();
            });
        });

        describe('Terminal type class', () => {
            it('should have cy-floating-window-terminal class', () => {
                const result: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

                expect(result.windowElement.classList.contains('cy-floating-window-terminal')).toBe(true);
            });
        });
    });
});
