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
 * Tests for agent tab click vs drag behavior.
 *
 * These tests use REAL mouse events (not synthetic DragEvents) to reproduce
 * the actual browser behavior where click and drag can conflict.
 *
 * The issue: When tab.draggable = true, even tiny mouse movements during
 * click can trigger dragstart, which may prevent the click event from firing.
 */

function createTestNodesDelta(): GraphDelta {
    return [
        {
            type: 'UpsertNode' as const,
            nodeToUpsert: {
                absoluteFilePathIsID: 'click-test-node-1.md',
                contentWithoutYamlOrLinks: '# Click Test 1',
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
                absoluteFilePathIsID: 'click-test-node-2.md',
                contentWithoutYamlOrLinks: '# Click Test 2',
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
    ];
}

test.describe('Agent tabs click vs drag behavior (real mouse events)', () => {
    test.beforeEach(async ({ page }) => {
        await setupMockElectronAPI(page);
        await page.goto('/');
        await page.waitForSelector('#root', { timeout: 5000 });
        await waitForCytoscapeReady(page);
        await exposeTerminalStoreAPI(page);
        await waitForTerminalStoreAPI(page);

        await sendGraphDelta(page, createTestNodesDelta());
        await page.waitForTimeout(100);

        // Create 2 terminals
        await page.evaluate(() => {
            const api = (window as unknown as { terminalStoreAPI: {
                addTerminal: (data: unknown) => void;
                createTerminalData: (params: { attachedToNodeId: string; terminalCount: number; title: string }) => unknown;
            }}).terminalStoreAPI;

            const terminal1 = api.createTerminalData({
                attachedToNodeId: 'click-test-node-1.md',
                terminalCount: 0,
                title: 'Tab-A'
            });
            const terminal2 = api.createTerminalData({
                attachedToNodeId: 'click-test-node-2.md',
                terminalCount: 1,
                title: 'Tab-B'
            });

            api.addTerminal(terminal1);
            api.addTerminal(terminal2);
        });

        await page.waitForSelector('.agent-tab', { timeout: 5000 });
        await expect(page.locator('.agent-tab')).toHaveCount(2);
    });

    test('clicking on first tab makes it active (simple click)', async ({ page }) => {
        // Use Playwright's .click() which simulates real mouse click
        const firstTab = page.locator('.agent-tab').first();

        // First tab should not be active initially (no terminal selected)
        await expect(firstTab).not.toHaveClass(/agent-tab-active/);

        // Click on the first tab
        await firstTab.click();

        // First tab should now be active
        await expect(firstTab).toHaveClass(/agent-tab-active/);
    });

    test('clicking on second tab after first makes second active', async ({ page }) => {
        const firstTab = page.locator('.agent-tab').first();
        const secondTab = page.locator('.agent-tab').nth(1);

        // Click first tab
        await firstTab.click();
        await expect(firstTab).toHaveClass(/agent-tab-active/);
        await expect(secondTab).not.toHaveClass(/agent-tab-active/);

        // Click second tab
        await secondTab.click();
        await expect(secondTab).toHaveClass(/agent-tab-active/);
        await expect(firstTab).not.toHaveClass(/agent-tab-active/);
    });

    test('click with tiny movement (2px) should still trigger click, not drag', async ({ page }) => {
        // This test reproduces the actual user behavior where slight mouse
        // movement during click might be interpreted as drag

        const firstTab = page.locator('.agent-tab').first();
        const box = await firstTab.boundingBox();
        if (!box) throw new Error('Could not get bounding box');

        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;

        // Simulate a click with 2px of movement (below 5px threshold)
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX + 2, centerY); // 2px horizontal movement
        await page.mouse.up();

        // Should have triggered click (tab becomes active), not drag
        await expect(firstTab).toHaveClass(/agent-tab-active/);
    });

    test('drag with 10px movement: dragstart fires but click also fires (potential issue)', async ({ page }) => {
        // This test documents what happens when user moves mouse 10px during click.
        // With the current implementation:
        // - dragstart DOES fire (movement > 5px threshold)
        // - BUT click ALSO fires
        //
        // This might be expected: the user initiated a drag gesture but didn't
        // complete it with a drop, so both events fire. However, this could
        // cause unwanted navigation during drag attempts.

        const firstTab = page.locator('.agent-tab').first();
        const box = await firstTab.boundingBox();
        if (!box) throw new Error('Could not get bounding box');

        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;

        // Track events
        await page.evaluate(() => {
            const w = window as unknown as {
                clickFired: boolean;
                dragStartFired: boolean;
                dragEndFired: boolean;
            };
            w.clickFired = false;
            w.dragStartFired = false;
            w.dragEndFired = false;

            const tab = document.querySelector('.agent-tab');
            tab?.addEventListener('click', () => { w.clickFired = true; });
            tab?.addEventListener('dragstart', () => { w.dragStartFired = true; });
            tab?.addEventListener('dragend', () => { w.dragEndFired = true; });
        });

        // Simulate a drag with 10px of movement using Playwright mouse API
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX + 10, centerY);
        await page.mouse.up();

        const events = await page.evaluate(() => {
            const w = window as unknown as {
                clickFired: boolean;
                dragStartFired: boolean;
                dragEndFired: boolean;
            };
            return {
                clickFired: w.clickFired,
                dragStartFired: w.dragStartFired,
                dragEndFired: w.dragEndFired,
            };
        });

        // Document actual behavior with Playwright's mouse API:
        // dragstart fires when movement > threshold
        expect(events.dragStartFired).toBe(true);
        // dragend does NOT fire - Playwright's mouse.up() doesn't complete the drag cycle
        expect(events.dragEndFired).toBe(false);
        // click fires because drag wasn't completed properly
        expect(events.clickFired).toBe(true);

        // CONCLUSION: Playwright's mouse API starts but doesn't complete HTML5 drag.
        // For testing actual drag behavior, use synthetic DragEvents (as in agent-tabs-drag-reorder.spec.ts)
    });

    test.skip('SKIP: real drag reorder requires HTML5 drag API which Playwright mouse cannot trigger', async ({ page }) => {
        // This test is SKIPPED because Playwright's mouse API cannot trigger HTML5 drag events.
        // The existing agent-tabs-drag-reorder.spec.ts tests use synthetic DragEvents to test drag
        // reordering, which bypasses the actual mouse-to-drag event chain.
        //
        // TO FIX DRAG PROPERLY:
        // Implement custom drag detection using mousemove events instead of relying on
        // the HTML5 drag API (draggable="true" + dragstart/dragend events).
        //
        // Custom drag would:
        // 1. Track mousedown position
        // 2. Listen to mousemove and check if movement exceeds threshold
        // 3. If threshold exceeded, enter drag mode and handle reordering visually
        // 4. On mouseup, finalize the drop

        const firstTab = page.locator('.agent-tab').first();
        const secondTab = page.locator('.agent-tab').nth(1);

        const firstBox = await firstTab.boundingBox();
        const secondBox = await secondTab.boundingBox();
        if (!firstBox || !secondBox) throw new Error('Could not get bounding boxes');

        const initialFirstId = await firstTab.getAttribute('data-terminal-id');
        const initialSecondId = await secondTab.getAttribute('data-terminal-id');

        const startX = firstBox.x + firstBox.width / 2;
        const startY = firstBox.y + firstBox.height / 2;
        const endX = secondBox.x + secondBox.width / 2;

        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 10, startY, { steps: 2 });
        await page.mouse.move(endX, startY, { steps: 5 });
        await page.mouse.up();

        await page.waitForTimeout(100);

        const newFirstId = await page.locator('.agent-tab').first().getAttribute('data-terminal-id');
        const newSecondId = await page.locator('.agent-tab').nth(1).getAttribute('data-terminal-id');

        // This WOULD be the expected result if drag worked
        expect(newFirstId).toBe(initialSecondId);
        expect(newSecondId).toBe(initialFirstId);
    });
});
