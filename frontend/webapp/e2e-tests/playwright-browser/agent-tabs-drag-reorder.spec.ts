import { test, expect } from '@playwright/test';
import {
    setupMockElectronAPI,
    waitForCytoscapeReady,
    exposeTerminalStoreAPI,
    waitForTerminalStoreAPI,
    sendGraphDelta,
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

/**
 * Helper to create test nodes that terminals can attach to
 */
function createTestNodesDelta(): GraphDelta {
    return [
        {
            type: 'UpsertNode' as const,
            nodeToUpsert: {
                relativeFilePathIsID: 'agent-test-node-1.md',
                contentWithoutYamlOrLinks: '# Agent Test 1',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: { _tag: 'None' } as const,
                    position: { _tag: 'Some', value: { x: 100, y: 100 } } as const,
                    additionalYAMLProps: new Map(),
                    isContextNode: true
                }
            },
            previousNode: { _tag: 'None' } as const
        },
        {
            type: 'UpsertNode' as const,
            nodeToUpsert: {
                relativeFilePathIsID: 'agent-test-node-2.md',
                contentWithoutYamlOrLinks: '# Agent Test 2',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: { _tag: 'None' } as const,
                    position: { _tag: 'Some', value: { x: 200, y: 100 } } as const,
                    additionalYAMLProps: new Map(),
                    isContextNode: true
                }
            },
            previousNode: { _tag: 'None' } as const
        },
        {
            type: 'UpsertNode' as const,
            nodeToUpsert: {
                relativeFilePathIsID: 'agent-test-node-3.md',
                contentWithoutYamlOrLinks: '# Agent Test 3',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: { _tag: 'None' } as const,
                    position: { _tag: 'Some', value: { x: 300, y: 100 } } as const,
                    additionalYAMLProps: new Map(),
                    isContextNode: true
                }
            },
            previousNode: { _tag: 'None' } as const
        }
    ];
}

/**
 * Get the order of tab terminal IDs from the DOM
 */
async function getTabOrder(page: typeof import('@playwright/test').Page.prototype): Promise<string[]> {
    return page.evaluate(() => {
        const tabs = document.querySelectorAll('.agent-tab');
        return Array.from(tabs).map(tab => tab.getAttribute('data-terminal-id') ?? '');
    });
}

/**
 * Perform a drag operation using HTML5 drag-drop events.
 * Mouse events alone don't trigger the drag API, so we dispatch
 * dragstart, dragover, and drop events directly.
 * @param position - 'left' for left half (ghost before tab), 'right' for right half (ghost after tab)
 */
async function dragTabToPosition(
    page: typeof import('@playwright/test').Page.prototype,
    fromIndex: number,
    toIndex: number,
    position: 'left' | 'right' = 'left'
): Promise<void> {
    // Dispatch HTML5 drag events to simulate dragging from one tab to another
    await page.evaluate(({ from, to, pos }) => {
        const tabs = document.querySelectorAll('.agent-tab');
        const sourceTab = tabs[from] as HTMLElement;
        const targetTab = tabs[to] as HTMLElement;
        const container = document.querySelector('.agent-tabs-scroll') as HTMLElement;

        if (!sourceTab || !container) {
            throw new Error(`Source tab ${from} not found`);
        }

        // Create a mock DataTransfer object
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', String(from));
        dataTransfer.effectAllowed = 'move';

        // Dispatch dragstart on source
        const dragStartEvent = new DragEvent('dragstart', {
            bubbles: true,
            cancelable: true,
            dataTransfer
        });
        sourceTab.dispatchEvent(dragStartEvent);

        // If we have a target tab, dispatch dragover on it
        // This positions the ghost element based on which half we're over
        if (targetTab) {
            const rect = targetTab.getBoundingClientRect();
            const clientX = pos === 'left'
                ? rect.left + rect.width * 0.25  // Left quarter
                : rect.left + rect.width * 0.75; // Right quarter

            const dragOverEvent = new DragEvent('dragover', {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientX
            });
            targetTab.dispatchEvent(dragOverEvent);
        } else {
            // Dropping at the end - dispatch on container
            const dragOverEvent = new DragEvent('dragover', {
                bubbles: true,
                cancelable: true,
                dataTransfer
            });
            container.dispatchEvent(dragOverEvent);
        }

        // Dispatch drop on the target (or container for end position)
        const dropTarget = targetTab || container;
        const dropEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer
        });
        dropTarget.dispatchEvent(dropEvent);

        // Dispatch dragend to clean up
        const dragEndEvent = new DragEvent('dragend', {
            bubbles: true,
            cancelable: true,
            dataTransfer
        });
        sourceTab.dispatchEvent(dragEndEvent);
    }, { from: fromIndex, to: toIndex, pos: position });
}

/**
 * Start a drag operation (for testing ghost visibility mid-drag)
 */
async function startDragOnTab(
    page: typeof import('@playwright/test').Page.prototype,
    tabIndex: number
): Promise<void> {
    await page.evaluate((index) => {
        const tabs = document.querySelectorAll('.agent-tab');
        const sourceTab = tabs[index] as HTMLElement;

        if (!sourceTab) {
            throw new Error(`Tab ${index} not found`);
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', String(index));
        dataTransfer.effectAllowed = 'move';

        const dragStartEvent = new DragEvent('dragstart', {
            bubbles: true,
            cancelable: true,
            dataTransfer
        });
        sourceTab.dispatchEvent(dragStartEvent);
    }, tabIndex);
}

/**
 * Simulate dragover on a specific tab (for testing ghost position)
 * @param position - 'left' for left half (ghost before tab), 'right' for right half (ghost after tab)
 */
async function dragOverTab(
    page: typeof import('@playwright/test').Page.prototype,
    sourceIndex: number,
    targetIndex: number,
    position: 'left' | 'right' = 'left'
): Promise<void> {
    await page.evaluate(({ from, to, pos }) => {
        const tabs = document.querySelectorAll('.agent-tab');
        const targetTab = tabs[to] as HTMLElement;

        if (!targetTab) {
            throw new Error(`Target tab ${to} not found`);
        }

        // Calculate clientX based on which half of the tab we want to hover over
        const rect = targetTab.getBoundingClientRect();
        const clientX = pos === 'left'
            ? rect.left + rect.width * 0.25  // Left quarter
            : rect.left + rect.width * 0.75; // Right quarter

        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', String(from));
        dataTransfer.effectAllowed = 'move';

        const dragOverEvent = new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX
        });
        targetTab.dispatchEvent(dragOverEvent);
    }, { from: sourceIndex, to: targetIndex, pos: position });
}

/**
 * End a drag operation (cleanup)
 */
async function endDragOnTab(
    page: typeof import('@playwright/test').Page.prototype,
    tabIndex: number
): Promise<void> {
    await page.evaluate((index) => {
        const tabs = document.querySelectorAll('.agent-tab');
        const sourceTab = tabs[index] as HTMLElement;

        if (!sourceTab) {
            throw new Error(`Tab ${index} not found`);
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.effectAllowed = 'move';

        const dragEndEvent = new DragEvent('dragend', {
            bubbles: true,
            cancelable: true,
            dataTransfer
        });
        sourceTab.dispatchEvent(dragEndEvent);
    }, tabIndex);
}

test.describe('Agent tabs drag-drop reordering', () => {
    test.beforeEach(async ({ page }) => {
        // Setup mock BEFORE navigating
        await setupMockElectronAPI(page);
        await page.goto('/');
        await page.waitForSelector('#root', { timeout: 5000 });
        await waitForCytoscapeReady(page);
        await exposeTerminalStoreAPI(page);
        await waitForTerminalStoreAPI(page);

        // Create test nodes for terminals to attach to
        await sendGraphDelta(page, createTestNodesDelta());
        await page.waitForTimeout(100);

        // Create 3 terminals via the store API
        await page.evaluate(() => {
            const api = (window as unknown as { terminalStoreAPI: {
                addTerminal: (data: unknown) => void;
                createTerminalData: (params: { attachedToNodeId: string; terminalCount: number; title: string }) => unknown;
            }}).terminalStoreAPI;

            const terminal1 = api.createTerminalData({
                attachedToNodeId: 'agent-test-node-1.md',
                terminalCount: 0,
                title: 'Tab-A'
            });
            const terminal2 = api.createTerminalData({
                attachedToNodeId: 'agent-test-node-2.md',
                terminalCount: 1,
                title: 'Tab-B'
            });
            const terminal3 = api.createTerminalData({
                attachedToNodeId: 'agent-test-node-3.md',
                terminalCount: 2,
                title: 'Tab-C'
            });

            api.addTerminal(terminal1);
            api.addTerminal(terminal2);
            api.addTerminal(terminal3);
        });

        // Wait for tabs to render
        await page.waitForSelector('.agent-tab', { timeout: 5000 });
        await expect(page.locator('.agent-tab')).toHaveCount(3);
    });

    test('dragging tab B to position of tab A moves B before A', async ({ page }) => {
        // Initial order: [A, B, C] (indices 0, 1, 2)
        // Drag B (index 1) onto A (index 0) = should move B before A
        // Result: [B, A, C]
        const initialOrder = await getTabOrder(page);
        expect(initialOrder).toHaveLength(3);

        // Drag tab at index 1 (B) to position of tab at index 0 (A)
        await dragTabToPosition(page, 1, 0);

        await page.waitForTimeout(100);
        const newOrder = await getTabOrder(page);

        // B should now be first
        expect(newOrder[0]).toBe(initialOrder[1]); // B is now first
        expect(newOrder[1]).toBe(initialOrder[0]); // A is now second
        expect(newOrder[2]).toBe(initialOrder[2]); // C unchanged
    });

    test('dragging tab A to LEFT half of tab B results in no change', async ({ page }) => {
        // Initial order: [A, B, C] (indices 0, 1, 2)
        // Drag A (index 0) onto B's LEFT half (index 1) = ghost appears before B
        // fromIndex=0, targetIndex=1, adjustedTarget = 1-1 = 0
        // A is already before B, so no visual change occurs
        const initialOrder = await getTabOrder(page);

        // Drag tab at index 0 (A) to LEFT half of tab at index 1 (B)
        await dragTabToPosition(page, 0, 1, 'left');

        await page.waitForTimeout(100);
        const newOrder = await getTabOrder(page);

        // Order should be unchanged: [A, B, C]
        expect(newOrder[0]).toBe(initialOrder[0]); // A stays first
        expect(newOrder[1]).toBe(initialOrder[1]); // B stays second
        expect(newOrder[2]).toBe(initialOrder[2]); // C stays third
    });

    test('dragging tab A to RIGHT half of tab B swaps positions', async ({ page }) => {
        // Initial order: [A, B, C] (indices 0, 1, 2)
        // Drag A (index 0) onto B's RIGHT half (index 1) = ghost appears AFTER B
        // fromIndex=0, targetIndex=2, adjustedTarget = 2-1 = 1
        // Result: [B, A, C]
        const initialOrder = await getTabOrder(page);

        // Drag tab at index 0 (A) to RIGHT half of tab at index 1 (B)
        await dragTabToPosition(page, 0, 1, 'right');

        await page.waitForTimeout(100);
        const newOrder = await getTabOrder(page);

        // A and B should swap: [B, A, C]
        expect(newOrder[0]).toBe(initialOrder[1]); // B is now first
        expect(newOrder[1]).toBe(initialOrder[0]); // A is now second
        expect(newOrder[2]).toBe(initialOrder[2]); // C unchanged
    });

    test('dragging tab A to position of tab C moves A before C', async ({ page }) => {
        // Initial order: [A, B, C] (indices 0, 1, 2)
        // Drag A (index 0) onto C (index 2) = ghost appears before C
        // fromIndex=0, targetIndex=2, adjustedTarget = 2-1 = 1
        // Result: [B, A, C] - A moves to index 1 (before C)
        const initialOrder = await getTabOrder(page);

        // Drag tab at index 0 (A) to position of tab at index 2 (C)
        await dragTabToPosition(page, 0, 2);

        await page.waitForTimeout(100);
        const newOrder = await getTabOrder(page);

        // A should be between B and C: [B, A, C]
        expect(newOrder[0]).toBe(initialOrder[1]); // B is now first
        expect(newOrder[1]).toBe(initialOrder[0]); // A is now second
        expect(newOrder[2]).toBe(initialOrder[2]); // C unchanged
    });

    test('ghost outline appears at correct position during drag (left half)', async ({ page }) => {
        // Start dragging tab B (index 1)
        await startDragOnTab(page, 1);

        // Hover over tab A's LEFT half (index 0) - ghost should appear before A
        await dragOverTab(page, 1, 0, 'left');
        await page.waitForTimeout(50);

        // Ghost should be visible and in the container
        const ghost = page.locator('.agent-tab-ghost');
        await expect(ghost).toBeVisible();

        // Ghost should be the first child in the container (before A)
        const ghostIsFirst = await page.evaluate(() => {
            const container = document.querySelector('.agent-tabs-scroll');
            const ghost = document.querySelector('.agent-tab-ghost');
            return container?.firstElementChild === ghost;
        });
        expect(ghostIsFirst).toBe(true);

        // Clean up
        await endDragOnTab(page, 1);
    });

    test('ghost outline appears after tab during drag (right half)', async ({ page }) => {
        // Start dragging tab B (index 1)
        await startDragOnTab(page, 1);

        // Hover over tab A's RIGHT half (index 0) - ghost should appear after A
        await dragOverTab(page, 1, 0, 'right');
        await page.waitForTimeout(50);

        // Ghost should be visible and in the container
        const ghost = page.locator('.agent-tab-ghost');
        await expect(ghost).toBeVisible();

        // Ghost should be after A (second child, between A and C - B is dragging)
        const ghostPosition = await page.evaluate(() => {
            const container = document.querySelector('.agent-tabs-scroll');
            const ghost = document.querySelector('.agent-tab-ghost');
            if (!container || !ghost) return -1;
            const children = Array.from(container.children);
            return children.indexOf(ghost);
        });
        // Position 1 means after A (index 0) - the ghost is between A and C
        expect(ghostPosition).toBe(1);

        // Clean up
        await endDragOnTab(page, 1);
    });

    test('dragging over own position does not show ghost in container', async ({ page }) => {
        // Start dragging tab B (index 1)
        await startDragOnTab(page, 1);

        // Hover over own position (tab B at index 1)
        await dragOverTab(page, 1, 1);
        await page.waitForTimeout(50);

        // Ghost should NOT be in the container (self-hover is skipped)
        // The ghost element is created but not inserted into the DOM when hovering over self
        const isInContainer = await page.evaluate(() => {
            const ghost = document.querySelector('.agent-tab-ghost');
            const container = document.querySelector('.agent-tabs-scroll');
            // Return false if ghost doesn't exist OR if it's not in container
            if (!ghost || !container) return false;
            return container.contains(ghost);
        });
        expect(isInContainer).toBe(false);

        // Clean up
        await endDragOnTab(page, 1);
    });
});
