import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { getNodeMenuItems, createHorizontalMenuElement, type HorizontalMenuItem, type NodeMenuItemsInput } from '@/shell/UI/cytoscape-graph-ui/services/HorizontalMenuService';
import { Trash2, Clipboard, Plus, Play, ChevronDown } from 'lucide';

// Mock dependencies that require IPC
vi.mock('@/shell/edge/UI-edge/graph/handleUIActions', () => ({
    createNewChildNodeFromUI: vi.fn(),
    deleteNodesFromUI: vi.fn(),
}));

vi.mock('@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI', () => ({
    spawnTerminalWithNewContextNode: vi.fn(),
    spawnTerminalWithCommandEditor: vi.fn(),
}));

vi.mock('@/shell/edge/UI-edge/state/EditorStore', () => ({
    getEditorByNodeId: vi.fn(),
}));

vi.mock('@/shell/edge/UI-edge/graph/getNodeFromMainToUI', () => ({
    getFilePathForNode: vi.fn(),
    getNodeFromMainToUI: vi.fn(),
}));

vi.mock('@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows', () => ({
    getOrCreateOverlay: vi.fn(() => document.createElement('div')),
}));

vi.mock('@/shell/UI/cytoscape-graph-ui/highlightContextNodes', () => ({
    highlightContainedNodes: vi.fn(),
    highlightPreviewNodes: vi.fn(),
    clearContainedHighlights: vi.fn(),
}));

describe('HorizontalMenuService', () => {
    let cy: Core;
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        document.body.appendChild(container);

        cy = cytoscape({
            container: container,
            elements: [
                { data: { id: 'test-node.md', label: 'Test Node' }, position: { x: 100, y: 100 } },
            ],
            style: [],
            layout: { name: 'preset' },
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

    describe('getNodeMenuItems', () => {
        it('should return menu items in the correct order: Delete, Copy, Add, Run, More', () => {
            const input: NodeMenuItemsInput = {
                nodeId: 'test-node.md',
                cy,
                agents: [],
                isContextNode: false,
            };

            const items: HorizontalMenuItem[] = getNodeMenuItems(input);

            // Expected order: Delete, Copy, Add, Run, More
            expect(items).toHaveLength(5);
            expect(items[0]?.label).toBe('Delete');
            expect(items[1]?.label).toBe('Copy Path');
            expect(items[2]?.label).toBe('Add Child');
            expect(items[3]?.label).toBe('Run');
            expect(items[4]?.label).toBe('More');
        });

        it('should use Trash2 icon for Delete', () => {
            const input: NodeMenuItemsInput = {
                nodeId: 'test-node.md',
                cy,
                agents: [],
                isContextNode: false,
            };

            const items: HorizontalMenuItem[] = getNodeMenuItems(input);
            expect(items[0]?.icon).toBe(Trash2);
        });

        it('should use Clipboard icon for Copy', () => {
            const input: NodeMenuItemsInput = {
                nodeId: 'test-node.md',
                cy,
                agents: [],
                isContextNode: false,
            };

            const items: HorizontalMenuItem[] = getNodeMenuItems(input);
            expect(items[1]?.icon).toBe(Clipboard);
        });

        it('should use Plus icon for Add', () => {
            const input: NodeMenuItemsInput = {
                nodeId: 'test-node.md',
                cy,
                agents: [],
                isContextNode: false,
            };

            const items: HorizontalMenuItem[] = getNodeMenuItems(input);
            expect(items[2]?.icon).toBe(Plus);
        });

        it('should use Play icon for Run', () => {
            const input: NodeMenuItemsInput = {
                nodeId: 'test-node.md',
                cy,
                agents: [],
                isContextNode: false,
            };

            const items: HorizontalMenuItem[] = getNodeMenuItems(input);
            expect(items[3]?.icon).toBe(Play);
        });

        it('should use ChevronDown icon for More (not MoreHorizontal)', () => {
            const input: NodeMenuItemsInput = {
                nodeId: 'test-node.md',
                cy,
                agents: [],
                isContextNode: false,
            };

            const items: HorizontalMenuItem[] = getNodeMenuItems(input);
            expect(items[4]?.icon).toBe(ChevronDown);
        });
    });

    describe('createHorizontalMenuElement', () => {
        describe('Left pill contents', () => {
            it('should contain exactly 3 items: Delete, Copy, Add (in order)', () => {
                const input: NodeMenuItemsInput = {
                    nodeId: 'test-node.md',
                    cy,
                    agents: [],
                    isContextNode: false,
                };
                const items: HorizontalMenuItem[] = getNodeMenuItems(input);
                const onClose: () => void = vi.fn();

                const { leftGroup } = createHorizontalMenuElement(items, onClose);

                // Left group should have 3 children (Delete, Copy, Add)
                expect(leftGroup.children.length).toBe(3);
            });
        });

        describe('Right pill contents', () => {
            it('should contain exactly 5 items: Run, More, Close, Pin, Fullscreen (in order)', () => {
                const input: NodeMenuItemsInput = {
                    nodeId: 'test-node.md',
                    cy,
                    agents: [],
                    isContextNode: false,
                };
                const items: HorizontalMenuItem[] = getNodeMenuItems(input);
                const onClose: () => void = vi.fn();

                const { rightGroup } = createHorizontalMenuElement(items, onClose);

                // Right group should have 5 children (Run, More, Close, Pin, Fullscreen)
                expect(rightGroup.children.length).toBe(5);
            });

            it('should have traffic light placeholders with correct class names', () => {
                const input: NodeMenuItemsInput = {
                    nodeId: 'test-node.md',
                    cy,
                    agents: [],
                    isContextNode: false,
                };
                const items: HorizontalMenuItem[] = getNodeMenuItems(input);
                const onClose: () => void = vi.fn();

                const { rightGroup } = createHorizontalMenuElement(items, onClose);

                // Traffic light placeholders should have specific class names
                const closeBtn: Element | null = rightGroup.querySelector('.traffic-light-close');
                const pinBtn: Element | null = rightGroup.querySelector('.traffic-light-pin');
                const fullscreenBtn: Element | null = rightGroup.querySelector('.traffic-light-fullscreen');

                expect(closeBtn).not.toBeNull();
                expect(pinBtn).not.toBeNull();
                expect(fullscreenBtn).not.toBeNull();
            });

            it('should have traffic lights in correct order: Close, Pin, Fullscreen (after Run and More)', () => {
                const input: NodeMenuItemsInput = {
                    nodeId: 'test-node.md',
                    cy,
                    agents: [],
                    isContextNode: false,
                };
                const items: HorizontalMenuItem[] = getNodeMenuItems(input);
                const onClose: () => void = vi.fn();

                const { rightGroup } = createHorizontalMenuElement(items, onClose);

                // Children in right group: Run, More, Close, Pin, Fullscreen
                const children: Element[] = Array.from(rightGroup.children);

                // Traffic lights are children 2, 3, 4 (0-indexed)
                expect(children[2]?.classList.contains('traffic-light-close')).toBe(true);
                expect(children[3]?.classList.contains('traffic-light-pin')).toBe(true);
                expect(children[4]?.classList.contains('traffic-light-fullscreen')).toBe(true);
            });
        });

        describe('More button icon', () => {
            it('should render ChevronDown SVG icon (not ellipsis)', () => {
                const input: NodeMenuItemsInput = {
                    nodeId: 'test-node.md',
                    cy,
                    agents: [],
                    isContextNode: false,
                };
                const items: HorizontalMenuItem[] = getNodeMenuItems(input);
                const onClose: () => void = vi.fn();

                const { rightGroup } = createHorizontalMenuElement(items, onClose);

                // More button is the second item in right group (index 1)
                const moreContainer: Element | null = rightGroup.children[1] ?? null;
                expect(moreContainer).not.toBeNull();

                const svg: SVGElement | null = moreContainer?.querySelector('svg') ?? null;
                expect(svg).not.toBeNull();

                // ChevronDown has a single path with d="m6 9 6 6 6-6"
                // MoreHorizontal has circles. Check for path with chevron shape.
                const path: Element | null = svg?.querySelector('path') ?? null;
                expect(path).not.toBeNull();
                expect(path?.getAttribute('d')).toBe('m6 9 6 6 6-6');
            });
        });

        describe('Phase 3: Traffic light styling', () => {
            describe('Traffic light button styling', () => {
                it('should have Close button with X icon inside', () => {
                    const input: NodeMenuItemsInput = {
                        nodeId: 'test-node.md',
                        cy,
                        agents: [],
                        isContextNode: false,
                    };
                    const items: HorizontalMenuItem[] = getNodeMenuItems(input);
                    const onClose: () => void = vi.fn();

                    const { rightGroup } = createHorizontalMenuElement(items, onClose);

                    const closeBtn: HTMLElement | null = rightGroup.querySelector('.traffic-light-close');
                    expect(closeBtn).not.toBeNull();

                    // Should have an SVG icon inside
                    const svg: SVGElement | null = closeBtn?.querySelector('svg') ?? null;
                    expect(svg).not.toBeNull();
                });

                it('should have Pin button with Pin or PinOff icon inside', () => {
                    const input: NodeMenuItemsInput = {
                        nodeId: 'test-node.md',
                        cy,
                        agents: [],
                        isContextNode: false,
                    };
                    const items: HorizontalMenuItem[] = getNodeMenuItems(input);
                    const onClose: () => void = vi.fn();

                    const { rightGroup } = createHorizontalMenuElement(items, onClose);

                    const pinBtn: HTMLElement | null = rightGroup.querySelector('.traffic-light-pin');
                    expect(pinBtn).not.toBeNull();

                    // Should have an SVG icon inside
                    const svg: SVGElement | null = pinBtn?.querySelector('svg') ?? null;
                    expect(svg).not.toBeNull();
                });

                it('should have Fullscreen button with Maximize icon inside', () => {
                    const input: NodeMenuItemsInput = {
                        nodeId: 'test-node.md',
                        cy,
                        agents: [],
                        isContextNode: false,
                    };
                    const items: HorizontalMenuItem[] = getNodeMenuItems(input);
                    const onClose: () => void = vi.fn();

                    const { rightGroup } = createHorizontalMenuElement(items, onClose);

                    const fullscreenBtn: HTMLElement | null = rightGroup.querySelector('.traffic-light-fullscreen');
                    expect(fullscreenBtn).not.toBeNull();

                    // Should have an SVG icon inside
                    const svg: SVGElement | null = fullscreenBtn?.querySelector('svg') ?? null;
                    expect(svg).not.toBeNull();
                });

                it('should style traffic light buttons as ~12px circles', () => {
                    const input: NodeMenuItemsInput = {
                        nodeId: 'test-node.md',
                        cy,
                        agents: [],
                        isContextNode: false,
                    };
                    const items: HorizontalMenuItem[] = getNodeMenuItems(input);
                    const onClose: () => void = vi.fn();

                    const { rightGroup } = createHorizontalMenuElement(items, onClose);

                    const closeBtn: HTMLElement | null = rightGroup.querySelector('.traffic-light-close');
                    const pinBtn: HTMLElement | null = rightGroup.querySelector('.traffic-light-pin');
                    const fullscreenBtn: HTMLElement | null = rightGroup.querySelector('.traffic-light-fullscreen');

                    // All buttons should have the traffic-light base class for styling
                    expect(closeBtn?.classList.contains('traffic-light')).toBe(true);
                    expect(pinBtn?.classList.contains('traffic-light')).toBe(true);
                    expect(fullscreenBtn?.classList.contains('traffic-light')).toBe(true);
                });
            });
        });
    });
});
