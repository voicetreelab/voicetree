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
 * Tests for agent tab click navigation.
 * Verifies that clicking on tabs correctly navigates between terminals.
 */

function createTestNodesDelta(): GraphDelta {
    return [
        {
            type: 'UpsertNode' as const,
            nodeToUpsert: {
                absoluteFilePathIsID: 'nav-test-node-1.md',
                contentWithoutYamlOrLinks: '# Nav Test 1',
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
                absoluteFilePathIsID: 'nav-test-node-2.md',
                contentWithoutYamlOrLinks: '# Nav Test 2',
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
                absoluteFilePathIsID: 'nav-test-node-3.md',
                contentWithoutYamlOrLinks: '# Nav Test 3',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: { _tag: 'None' } as const,
                    position: { _tag: 'Some', value: { x: 300, y: 100 } } as const,
                    additionalYAMLProps: new Map(),
                    isContextNode: true
                }
            },
            previousNode: { _tag: 'None' } as const
        },
    ];
}

test.describe('Agent tabs click navigation', () => {
    test.beforeEach(async ({ page }) => {
        await setupMockElectronAPI(page);
        await page.goto('/');
        await page.waitForSelector('#root', { timeout: 5000 });
        await waitForCytoscapeReady(page);
        await exposeTerminalStoreAPI(page);
        await waitForTerminalStoreAPI(page);

        await sendGraphDelta(page, createTestNodesDelta());
        await page.waitForTimeout(100);

        // Create 3 terminals
        await page.evaluate(() => {
            const api = (window as unknown as { terminalStoreAPI: {
                addTerminal: (data: unknown) => void;
                createTerminalData: (params: { attachedToNodeId: string; terminalCount: number; title: string }) => unknown;
            }}).terminalStoreAPI;

            const terminal1 = api.createTerminalData({
                attachedToNodeId: 'nav-test-node-1.md',
                terminalCount: 0,
                title: 'Terminal-1'
            });
            const terminal2 = api.createTerminalData({
                attachedToNodeId: 'nav-test-node-2.md',
                terminalCount: 1,
                title: 'Terminal-2'
            });
            const terminal3 = api.createTerminalData({
                attachedToNodeId: 'nav-test-node-3.md',
                terminalCount: 2,
                title: 'Terminal-3'
            });

            api.addTerminal(terminal1);
            api.addTerminal(terminal2);
            api.addTerminal(terminal3);
        });

        await page.waitForSelector('.agent-tab', { timeout: 5000 });
        await expect(page.locator('.agent-tab')).toHaveCount(3);
    });

    test('clicking first tab activates it', async ({ page }) => {
        const firstTab = page.locator('.agent-tab').first();

        await expect(firstTab).not.toHaveClass(/agent-tab-active/);
        await firstTab.click();
        await expect(firstTab).toHaveClass(/agent-tab-active/);
    });

    test('clicking through all tabs activates each one', async ({ page }) => {
        const tabs = page.locator('.agent-tab');
        const tab1 = tabs.nth(0);
        const tab2 = tabs.nth(1);
        const tab3 = tabs.nth(2);

        // Click first tab
        await tab1.click();
        await expect(tab1).toHaveClass(/agent-tab-active/);
        await expect(tab2).not.toHaveClass(/agent-tab-active/);
        await expect(tab3).not.toHaveClass(/agent-tab-active/);

        // Click second tab
        await tab2.click();
        await expect(tab1).not.toHaveClass(/agent-tab-active/);
        await expect(tab2).toHaveClass(/agent-tab-active/);
        await expect(tab3).not.toHaveClass(/agent-tab-active/);

        // Click third tab
        await tab3.click();
        await expect(tab1).not.toHaveClass(/agent-tab-active/);
        await expect(tab2).not.toHaveClass(/agent-tab-active/);
        await expect(tab3).toHaveClass(/agent-tab-active/);
    });

    test('clicking tabs in reverse order works', async ({ page }) => {
        const tabs = page.locator('.agent-tab');
        const tab1 = tabs.nth(0);
        const tab2 = tabs.nth(1);
        const tab3 = tabs.nth(2);

        // Click third tab first
        await tab3.click();
        await expect(tab3).toHaveClass(/agent-tab-active/);

        // Click second tab
        await tab2.click();
        await expect(tab2).toHaveClass(/agent-tab-active/);
        await expect(tab3).not.toHaveClass(/agent-tab-active/);

        // Click first tab
        await tab1.click();
        await expect(tab1).toHaveClass(/agent-tab-active/);
        await expect(tab2).not.toHaveClass(/agent-tab-active/);
    });

    test('rapidly clicking between two tabs toggles active state', async ({ page }) => {
        const tab1 = page.locator('.agent-tab').nth(0);
        const tab2 = page.locator('.agent-tab').nth(1);

        // Click back and forth rapidly
        await tab1.click();
        await expect(tab1).toHaveClass(/agent-tab-active/);

        await tab2.click();
        await expect(tab2).toHaveClass(/agent-tab-active/);
        await expect(tab1).not.toHaveClass(/agent-tab-active/);

        await tab1.click();
        await expect(tab1).toHaveClass(/agent-tab-active/);
        await expect(tab2).not.toHaveClass(/agent-tab-active/);

        await tab2.click();
        await expect(tab2).toHaveClass(/agent-tab-active/);
        await expect(tab1).not.toHaveClass(/agent-tab-active/);
    });

    test('clicking same tab multiple times keeps it active', async ({ page }) => {
        const tab1 = page.locator('.agent-tab').first();

        await tab1.click();
        await expect(tab1).toHaveClass(/agent-tab-active/);

        // Click again - should still be active
        await tab1.click();
        await expect(tab1).toHaveClass(/agent-tab-active/);

        // Click again
        await tab1.click();
        await expect(tab1).toHaveClass(/agent-tab-active/);
    });
});
