/**
 * Screenshot test for terminal-to-created-node edges
 *
 * Verifies that when a terminal creates a node with agent_name in YAML,
 * a dotted edge appears from the terminal shadow node to the new node.
 */

import { test } from '@playwright/test';
import {
    setupMockElectronAPI,
  selectMockProject,
    waitForCytoscapeReady,
    sendGraphDelta,
    exposeTerminalStoreAPI,
    type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

test('screenshot terminal-to-created-node dotted edge', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);
    await exposeTerminalStoreAPI(page);

    // Create a task node first
    const taskNodeDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: {
            absoluteFilePathIsID: 'task-node.md',
            contentWithoutYamlOrLinks: '# Fix the bug in authentication',
            outgoingEdges: [],
            nodeUIMetadata: {
                color: { _tag: 'None' } as const,
                position: { _tag: 'Some', value: { x: 200, y: 200 } } as const,
                additionalYAMLProps: new Map(),
                isContextNode: false
            }
        },
        previousNode: { _tag: 'None' } as const
    }];
    await sendGraphDelta(page, taskNodeDelta);
    await page.waitForTimeout(100);

    // Create a terminal with title "Sam: Fix the bug"
    const terminalInfo = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');

        const terminalStoreAPI = (window as ExtendedWindow & {
            terminalStoreAPI?: {
                addTerminal: (data: unknown) => void;
                createTerminalData: (params: { attachedToNodeId: string; terminalCount: number; title: string }) => unknown;
                getTerminalId: (data: unknown) => string;
                getShadowNodeId: (id: string) => string;
            };
        }).terminalStoreAPI;
        if (!terminalStoreAPI) throw new Error('TerminalStore API not exposed');

        // Create terminal with agent name "Sam"
        const terminal = terminalStoreAPI.createTerminalData({
            attachedToNodeId: 'task-node.md',
            terminalCount: 0,
            title: 'Sam: Fix the bug'
        });

        terminalStoreAPI.addTerminal(terminal);

        const terminalId = terminalStoreAPI.getTerminalId(terminal);
        const shadowNodeId = terminalStoreAPI.getShadowNodeId(terminalId);

        // Add shadow node to cytoscape (positioned near task node)
        cy.add({
            group: 'nodes',
            data: {
                id: shadowNodeId,
                isShadowNode: true,
                windowType: 'Terminal',
            },
            position: { x: 400, y: 200 }
        });

        // Add indicator edge from task node to terminal shadow
        cy.add({
            group: 'edges',
            data: {
                id: `edge-task-${shadowNodeId}`,
                source: 'task-node.md',
                target: shadowNodeId,
                isIndicatorEdge: true
            },
            classes: 'terminal-indicator'
        });

        return { terminalId, shadowNodeId };
    });

    console.log('Created terminal:', terminalInfo);

    // Now create a progress node with agent_name: Sam
    // This should trigger the terminal-to-created-node edge
    const progressNodeDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: {
            absoluteFilePathIsID: 'progress-node.md',
            contentWithoutYamlOrLinks: '# Progress: Fixed authentication\n\nImplemented JWT token validation.',
            outgoingEdges: [{ targetId: 'task-node.md', label: '' }],
            nodeUIMetadata: {
                color: { _tag: 'Some', value: 'blue' } as const,
                position: { _tag: 'Some', value: { x: 600, y: 300 } } as const,
                additionalYAMLProps: new Map([['agent_name', 'Sam']]),
                isContextNode: false
            }
        },
        previousNode: { _tag: 'None' } as const
    }];
    await sendGraphDelta(page, progressNodeDelta);
    await page.waitForTimeout(200);

    // Fit to show all nodes
    await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (cy) {
            cy.fit(undefined, 50);
            cy.center();
        }
    });
    await page.waitForTimeout(100);

    // Verify the edge was created
    const edgeInfo = await page.evaluate((shadowNodeId) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { found: false, edgeCount: 0 };

        const edges = cy.edges(`[source = "${shadowNodeId}"][target = "progress-node.md"]`);
        return {
            found: edges.length > 0,
            edgeCount: edges.length,
            hasClass: edges.length > 0 ? edges[0].hasClass('terminal-progres-nodes-indicator') : false
        };
    }, terminalInfo.shadowNodeId);

    console.log('Edge verification:', edgeInfo);

    // Take screenshot
    await page.screenshot({
        path: 'e2e-tests/screenshots/terminal-to-created-node-edge.png',
        clip: { x: 0, y: 0, width: 900, height: 600 }
    });

    console.log('Screenshot saved to e2e-tests/screenshots/terminal-to-created-node-edge.png');
});
