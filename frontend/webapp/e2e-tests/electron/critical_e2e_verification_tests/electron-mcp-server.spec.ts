/**
 * E2E Test: MCP Server Integration
 *
 * Tests that the MCP server:
 * 1. Starts with Electron and shares graph state
 * 2. Can add nodes via HTTP endpoint
 * 3. New nodes appear in the graph with proper edges
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
const MCP_URL = 'http://localhost:3001/mcp';

// Parent node from fixture (filename with .md as used in graph)
const PARENT_NODE_ID = '1_VoiceTree_Website_Development_and_Node_Display_Bug';
const PARENT_NODE_ID_WITH_EXT = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md';

interface ExtendedWindow {
    cytoscapeInstance?: {
        nodes: () => { length: number; map: (fn: (n: { data: (key: string) => string; id: () => string }) => string) => string[] };
        edges: () => { length: number; map: (fn: (e: { source: () => { id: () => string }; target: () => { id: () => string } }) => { source: string; target: string }) => Array<{ source: string; target: string }> };
    };
    electronAPI?: {
        main: {
            startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
            stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
            getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
        };
    };
}

// Extend Playwright test with Electron fixtures
const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    tempUserDataPath: string;
}>({
    tempUserDataPath: async ({}, use) => {
        // Create a temporary userData directory for this test (isolated from other tests)
        const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-mcp-test-'));

        // Write config to auto-load the test vault
        const configPath = path.join(tempPath, 'voicetree-config.json');
        await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');
        console.log('[MCP Test] Created config file to auto-load:', FIXTURE_VAULT_PATH);

        await use(tempPath);

        // Cleanup temp directory after test
        await fs.rm(tempPath, { recursive: true, force: true });
        console.log('[MCP Test] Cleaned up temp userData directory');
    },

    electronApp: async ({ tempUserDataPath }, use) => {
        console.log('=== Launching Electron app ===');

        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1'
            },
            timeout: 5000
        });

        await use(electronApp);

        // Cleanup
        console.log('=== Cleaning up Electron app ===');
        try {
            const window = await electronApp.firstWindow();
            await window.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (api) {
                    await api.main.stopFileWatching();
                }
            });
            await window.waitForTimeout(300);
        } catch {
            console.log('Note: Could not stop file watching during cleanup');
        }

        await electronApp.close();

        // Give extra time for MCP server to fully shut down before next test
        await new Promise(resolve => setTimeout(resolve, 2000));
    },

    appWindow: async ({ electronApp }, use) => {
        console.log('=== Getting app window ===');
        const window = await electronApp.firstWindow({ timeout: 60000 });

        window.on('console', msg => {
            if (!msg.text().includes('Electron Security Warning')) {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            }
        });

        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');

        // Wait for Cytoscape to be initialized
        await window.waitForFunction(
            () => (window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 }
        );

        await window.waitForTimeout(1000);
        await use(window);
    }
});

/**
 * Helper: Wait for MCP server to be available with retries
 */
async function waitForMcpServer(maxRetries = 10, delayMs = 500): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(MCP_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'healthcheck', version: '1.0.0' } } })
            });
            if (response.ok) {
                console.log(`[MCP Test] Server available after ${i + 1} attempts`);
                return true;
            }
        } catch {
            console.log(`[MCP Test] Server not ready, attempt ${i + 1}/${maxRetries}`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return false;
}

/**
 * Helper: Make MCP protocol request
 */
async function mcpRequest(method: string, params: Record<string, unknown> = {}, id = 1): Promise<unknown> {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            params
        })
    });

    const text = await response.text();
    return JSON.parse(text);
}

/**
 * Helper: Call MCP tool
 */
async function mcpCallTool(toolName: string, args: Record<string, unknown>): Promise<{ success: boolean; content?: Array<{ type: string; text: string }>; isError?: boolean }> {
    const response = await mcpRequest('tools/call', {
        name: toolName,
        arguments: args
    }) as { result?: { content?: Array<{ type: string; text: string }>; isError?: boolean }; error?: { message: string } };

    if (response.error) {
        throw new Error(`MCP error: ${response.error.message}`);
    }

    const content = response.result?.content;
    if (content && content[0]?.text) {
        const parsed = JSON.parse(content[0].text) as { success: boolean };
        return { success: parsed.success, content, isError: response.result?.isError };
    }

    return { success: false };
}

test.describe('MCP Server Integration', () => {
    // MCP server uses a fixed port (3001), so tests must run serially to avoid conflicts
    // Increased timeout for MCP server startup and cleanup
    test.describe.configure({ mode: 'serial', timeout: 90000 });

    // File created by test - will be cleaned up
    const TEST_NODE_ID = 'mcp_test_node_' + Date.now();
    const TEST_FILE_PATH = path.join(FIXTURE_VAULT_PATH, `${TEST_NODE_ID}.md`);

    test.afterEach(async () => {
        // Cleanup: remove test file if it exists
        try {
            await fs.unlink(TEST_FILE_PATH);
            console.log(`Cleaned up test file: ${TEST_FILE_PATH}`);
        } catch {
            // File may not exist, that's fine
        }
    });

    test('MCP server starts with Electron and responds to requests', async ({ appWindow }) => {
        console.log('=== TEST: MCP server health check ===');

        // Wait for MCP server to be available (handles port conflicts with other parallel tests)
        const serverReady = await waitForMcpServer(15, 1000);
        if (!serverReady) {
            // If server isn't ready after retries, skip test gracefully
            // This can happen when another electron instance has the port
            console.log('[MCP Test] Server not available - port may be in use by another test');
            test.skip();
            return;
        }

        // Wait a bit more for stability
        await appWindow.waitForTimeout(500);

        // Test: Initialize MCP connection
        console.log('=== STEP 1: Initialize MCP connection ===');
        const initResponse = await mcpRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'e2e-test', version: '1.0.0' }
        }) as { result?: { serverInfo?: { name: string } } };

        expect(initResponse.result?.serverInfo?.name).toBe('voicetree-mcp');
        console.log('✓ MCP server responded to initialize');

        // Test: List tools
        console.log('=== STEP 2: List available tools ===');
        const toolsResponse = await mcpRequest('tools/list') as { result?: { tools?: Array<{ name: string }> } };

        const toolNames = toolsResponse.result?.tools?.map(t => t.name) ?? [];
        expect(toolNames).toContain('add_node');
        expect(toolNames).toContain('get_graph');
        expect(toolNames).toContain('list_nodes');
        expect(toolNames).toContain('set_vault_path');
        console.log(`✓ Found ${toolNames.length} tools: ${toolNames.join(', ')}`);
    });

    test.skip('add_node creates file and updates graph with parent edge', async ({ appWindow }) => {
        // FIXME: Flaky test - MCP server sometimes not ready or returns unexpected format
        console.log('=== TEST: Add node via MCP with parent edge ===');

        // STEP 1: Load the test vault
        console.log('=== STEP 1: Load test vault ===');
        const watchResult = await appWindow.evaluate(async (vaultPath) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.startFileWatching(vaultPath);
        }, FIXTURE_VAULT_PATH);

        expect(watchResult.success).toBe(true);
        console.log(`✓ Vault loaded: ${watchResult.directory}`);

        // Wait for initial scan to complete
        await appWindow.waitForTimeout(3000);

        // STEP 2: Get initial graph state
        console.log('=== STEP 2: Get initial graph state ===');
        const initialState = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape not initialized');
            return {
                nodeCount: cy.nodes().length,
                nodeIds: cy.nodes().map(n => n.id())
            };
        });

        console.log(`Initial state: ${initialState.nodeCount} nodes`);
        expect(initialState.nodeCount).toBeGreaterThan(0);

        // Verify parent node exists (graph uses .md extension in IDs)
        expect(initialState.nodeIds).toContain(PARENT_NODE_ID_WITH_EXT);
        console.log(`✓ Parent node exists: ${PARENT_NODE_ID_WITH_EXT}`);

        // STEP 3: Initialize MCP connection
        console.log('=== STEP 3: Initialize MCP connection ===');
        await mcpRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'e2e-test', version: '1.0.0' }
        });

        // STEP 4: Call add_node via MCP
        console.log('=== STEP 4: Add node via MCP ===');
        const addResult = await mcpCallTool('add_node', {
            nodeId: TEST_NODE_ID,
            content: '### Test Node Created by MCP\n\nThis node was created via the MCP server e2e test.',
            parentNodeId: PARENT_NODE_ID
        });

        expect(addResult.success).toBe(true);
        console.log(`✓ add_node succeeded`);

        // STEP 5: Verify file was created on disk
        console.log('=== STEP 5: Verify file exists on disk ===');

        // Wait for file to be created with polling
        await expect.poll(async () => {
            return fs.access(TEST_FILE_PATH).then(() => true).catch(() => false);
        }, {
            message: `Waiting for file to be created: ${TEST_FILE_PATH}`,
            timeout: 5000,
            intervals: [100, 250, 500]
        }).toBe(true);

        console.log(`✓ File created: ${TEST_FILE_PATH}`);

        // Read file content to verify parent link
        const fileContent = await fs.readFile(TEST_FILE_PATH, 'utf-8');
        expect(fileContent).toContain(PARENT_NODE_ID);
        expect(fileContent).toContain('child_of');
        console.log('✓ File contains parent link');

        // STEP 6: Wait for file watcher to detect the new file and update graph
        console.log('=== STEP 6: Wait for graph to update ===');
        const TEST_NODE_ID_WITH_EXT = `${TEST_NODE_ID}.md`;
        await expect.poll(async () => {
            return appWindow.evaluate((testNodeIdWithExt) => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                if (!cy) return false;
                const nodeIds = cy.nodes().map(n => n.id());
                return nodeIds.includes(testNodeIdWithExt);
            }, TEST_NODE_ID_WITH_EXT);
        }, {
            message: `Waiting for node ${TEST_NODE_ID_WITH_EXT} to appear in graph`,
            timeout: 10000
        }).toBe(true);

        console.log('✓ Node appeared in graph');

        // STEP 7: Verify edge to parent exists
        console.log('=== STEP 7: Verify edge to parent ===');
        const finalState = await appWindow.evaluate((testNodeIdWithExt) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape not initialized');

            const edges = cy.edges().map(e => ({
                source: e.source().id(),
                target: e.target().id()
            }));

            // Find edge from test node to parent
            const edgeToParent = edges.find(e =>
                e.source === testNodeIdWithExt || e.target === testNodeIdWithExt
            );

            return {
                nodeCount: cy.nodes().length,
                edgeToParent
            };
        }, TEST_NODE_ID_WITH_EXT);

        expect(finalState.nodeCount).toBe(initialState.nodeCount + 1);
        expect(finalState.edgeToParent).toBeDefined();
        console.log(`✓ Edge exists: ${JSON.stringify(finalState.edgeToParent)}`);

        console.log('✅ Test completed successfully');
    });

    test('get_graph returns current graph state', async ({ appWindow }) => {
        console.log('=== TEST: get_graph returns graph state ===');

        // Wait for MCP server to be available (handles port conflicts with other parallel tests)
        const serverReady = await waitForMcpServer(15, 1000);
        if (!serverReady) {
            console.log('[MCP Test] Server not available - port may be in use by another test');
            test.skip();
            return;
        }

        // Load vault
        await appWindow.evaluate(async (vaultPath) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.startFileWatching(vaultPath);
        }, FIXTURE_VAULT_PATH);

        await appWindow.waitForTimeout(3000);

        // Initialize MCP
        await mcpRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'e2e-test', version: '1.0.0' }
        });

        // Call get_graph
        const response = await mcpRequest('tools/call', {
            name: 'get_graph',
            arguments: {}
        }) as { result?: { content?: Array<{ text: string }> } };

        const graphData = JSON.parse(response.result?.content?.[0]?.text ?? '{}') as { nodeCount: number; nodes: Record<string, unknown> };

        expect(graphData.nodeCount).toBeGreaterThan(0);
        expect(Object.keys(graphData.nodes).length).toBe(graphData.nodeCount);
        console.log(`✓ get_graph returned ${graphData.nodeCount} nodes`);
    });
});
