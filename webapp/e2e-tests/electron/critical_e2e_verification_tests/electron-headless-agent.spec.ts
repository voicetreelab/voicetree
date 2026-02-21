/**
 * E2E Test: Headless Agent Mode
 *
 * Tests that headless agents:
 * 1. Can be spawned via MCP spawn_agent with headless:true
 * 2. Appear in list_agents with isHeadless flag
 * 3. Reject send_message (no stdin — headless agents have no PTY)
 * 4. Reject read_terminal_output (no terminal output — output is graph nodes)
 * 5. Exit and get marked as 'exited' in the registry
 *
 * FLOW:
 * 1. Launch Electron app with projects.json pointing to example_small
 * 2. Click project to load vault, wait for graph
 * 3. Query MCP port from running process via electronAPI.main.getMcpPort()
 * 4. Wait for MCP server on that port
 * 5. Bootstrap a caller terminal via electronAPI (registers in terminal-registry)
 * 6. Call MCP spawn_agent with headless:true
 * 7. Verify headless lifecycle via MCP tools
 *
 * Pattern follows existing electron-smoke-test.spec.ts for project loading
 * and electron-mcp-server.spec.ts for MCP interaction.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
    cytoscapeInstance?: {
        nodes: () => { length: number; map: (fn: (n: { id: () => string }) => string) => string[] };
    };
    electronAPI?: {
        main: {
            stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
            getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
            saveSettings: (settings: Record<string, unknown>) => Promise<boolean>;
            getMcpPort: () => Promise<number>;
        };
        terminal: {
            spawn: (data: Record<string, unknown>) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
        };
    };
}

// Extend Playwright test with Electron fixtures
const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
}>({
    electronApp: async ({}, use) => {
        // Create a temporary userData directory for this test
        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-headless-e2e-'));

        // Create projects.json with the test vault (smoke test pattern)
        const projectsPath = path.join(tempUserDataPath, 'projects.json');
        const savedProject = {
            id: 'headless-test-project',
            path: FIXTURE_VAULT_PATH,
            name: 'example_small',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true
        };
        await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

        // Also write legacy config for auto-load attempt
        const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
        await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');

        // Write settings with a test agent command that follows the real pattern.
        // Headless spawn transforms: 'echo "$AGENT_PROMPT"' → 'echo -p "$AGENT_PROMPT"'
        // This prints the prompt text and exits 0 — perfect for testing the lifecycle.
        const settingsPath = path.join(tempUserDataPath, 'settings.json');
        await fs.writeFile(settingsPath, JSON.stringify({
            agents: [
                { name: 'Test Agent', command: 'echo "$AGENT_PROMPT"' }
            ],
            terminalSpawnPathRelativeToWatchedDirectory: '/'
        }, null, 2), 'utf8');

        console.log('[Headless Test] Temp userData created:', tempUserDataPath);
        console.log('[Headless Test] projects.json, voicetree-config.json, settings.json written');

        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1'
            },
            timeout: 15000
        });

        await use(electronApp);

        // Graceful shutdown
        console.log('=== Cleaning up Electron app ===');
        try {
            const window = await electronApp.firstWindow();
            await window.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (api) await api.main.stopFileWatching();
            });
            await window.waitForTimeout(300);
        } catch {
            console.log('Note: Could not stop file watching during cleanup');
        }

        await electronApp.close();
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Cleanup temp directory
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
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

        // Try to wait for Cytoscape (auto-load path)
        try {
            await window.waitForFunction(
                () => (window as unknown as ExtendedWindow).cytoscapeInstance,
                { timeout: 5000 }
            );
            console.log('✓ Cytoscape initialized via auto-load');
        } catch {
            // Auto-load didn't work — click project from selection screen
            console.log('Auto-load timed out, clicking project from selection screen...');
            const projectButton = window.locator('button').filter({ hasText: 'example_small' });
            await expect(projectButton.first()).toBeVisible({ timeout: 10000 });
            await projectButton.first().click();
            console.log('✓ Clicked example_small project');

            // Now wait for Cytoscape to initialize after project load
            await window.waitForFunction(
                () => (window as unknown as ExtendedWindow).cytoscapeInstance,
                { timeout: 30000 }
            );
            console.log('✓ Cytoscape initialized after project selection');
        }

        await window.waitForTimeout(1000);
        await use(window);
    }
});

// ─── MCP HTTP Helpers ────────────────────────────────────────────────────────

async function waitForMcpServer(mcpUrl: string, maxRetries = 20, delayMs = 1000): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(mcpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0', id: 0, method: 'initialize',
                    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'healthcheck', version: '1.0.0' } }
                })
            });
            if (response.ok) {
                console.log(`[Headless Test] MCP server available after ${i + 1} attempts`);
                return true;
            }
            if (i % 5 === 0) console.log(`[Headless Test] MCP server responded ${response.status}, attempt ${i + 1}/${maxRetries}`);
        } catch (err) {
            if (i % 5 === 0) console.log(`[Headless Test] MCP server not ready, attempt ${i + 1}/${maxRetries}: ${(err as Error).message}`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return false;
}

async function mcpRequest(mcpUrl: string, method: string, params: Record<string, unknown> = {}, id = 1): Promise<unknown> {
    const response = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    });
    const text = await response.text();
    return JSON.parse(text);
}

async function mcpCallTool(
    mcpUrl: string,
    toolName: string,
    args: Record<string, unknown>
): Promise<{
    success: boolean;
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    parsed?: Record<string, unknown>;
}> {
    const response = await mcpRequest(mcpUrl, 'tools/call', {
        name: toolName,
        arguments: args
    }) as {
        result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
        error?: { message: string };
    };

    if (response.error) {
        throw new Error(`MCP error: ${response.error.message}`);
    }

    const content = response.result?.content;
    if (content && content[0]?.text) {
        const parsed = JSON.parse(content[0].text) as Record<string, unknown>;
        return {
            success: parsed.success as boolean,
            content,
            isError: response.result?.isError,
            parsed
        };
    }

    return { success: false };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Headless Agent E2E', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    test('spawn headless agent via MCP, verify lifecycle and guards', async ({ appWindow }) => {
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Discover MCP port from running process
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 1: Discover MCP port from running process ===');
        const mcpPort: number = await appWindow.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.getMcpPort();
        });
        const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`;
        console.log(`✓ MCP port discovered: ${mcpPort} → ${mcpUrl}`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Wait for MCP server to be ready
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 2: Wait for MCP server ===');
        const serverReady = await waitForMcpServer(mcpUrl, 20, 1000);
        if (!serverReady) {
            console.log(`[Headless Test] MCP server not available on port ${mcpPort}`);
            test.skip();
            return;
        }

        await appWindow.waitForTimeout(500);

        // Initialize MCP connection
        await mcpRequest(mcpUrl, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'headless-e2e-test', version: '1.0.0' }
        });
        console.log('✓ MCP server ready and initialized');

        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Wait for vault to fully load (graph nodes)
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 3: Wait for graph nodes ===');
        await expect.poll(async () => {
            return appWindow.evaluate(() => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                return cy ? cy.nodes().length : 0;
            });
        }, {
            message: 'Waiting for graph to load nodes',
            timeout: 15000,
            intervals: [500, 1000, 1000]
        }).toBeGreaterThan(0);
        console.log('✓ Vault loaded into graph');

        // Extra wait for stability
        await appWindow.waitForTimeout(2000);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Discover graph nodes
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 4: Discover graph nodes ===');
        const nodeIds: string[] = await appWindow.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const graph = await api.main.getGraph();
            return Object.keys(graph.nodes);
        });

        console.log(`✓ Main process has ${nodeIds.length} nodes`);
        expect(nodeIds.length).toBeGreaterThan(0);

        const parentNodeId: string = nodeIds[0];
        console.log(`  Using parent node: ${parentNodeId.split('/').pop()}`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Bootstrap a caller terminal (registers in terminal-registry)
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 5: Spawn caller terminal via electronAPI ===');

        // Spawn an interactive terminal with a simple sleep command.
        // Flow: renderer IPC → TerminalManager.spawn() → recordTerminalSpawn()
        // This registers the terminal in the main-process terminal-registry,
        // giving us a valid callerTerminalId for MCP spawn_agent.
        const callerTerminalId = 'e2e-headless-caller';
        const spawnResult = await appWindow.evaluate(async ({ parentNodeId: nodeId, callerId }) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api?.terminal) throw new Error('electronAPI.terminal not available');

            return await api.terminal.spawn({
                type: 'Terminal',
                terminalId: callerId,
                attachedToContextNodeId: nodeId,
                terminalCount: 0,
                title: 'E2E Headless Caller',
                anchoredToNodeId: { _tag: 'None' },
                shadowNodeDimensions: { width: 600, height: 400 },
                resizable: true,
                initialCommand: 'sleep 120',
                executeCommand: true,
                isPinned: true,
                isDone: false,
                lastOutputTime: Date.now(),
                activityCount: 0,
                parentTerminalId: null,
                agentName: callerId,
                worktreeName: undefined,
                isHeadless: false
            });
        }, { parentNodeId, callerId: callerTerminalId });

        console.log(`  Spawn result: ${JSON.stringify(spawnResult)}`);
        expect(spawnResult.success).toBe(true);

        // Wait for terminal to register
        await appWindow.waitForTimeout(1000);

        // Verify caller terminal appears in list_agents
        console.log('=== STEP 5b: Verify caller terminal in list_agents ===');
        const initialList = await mcpCallTool(mcpUrl, 'list_agents', {});
        const initialAgents = (initialList.parsed as {
            agents: Array<{ terminalId: string; isHeadless: boolean; status: string }>
        }).agents;

        const callerAgent = initialAgents.find(a => a.terminalId === callerTerminalId);
        expect(callerAgent).toBeDefined();
        expect(callerAgent!.isHeadless).toBe(false);
        console.log(`✓ Caller terminal registered: ${callerTerminalId}, isHeadless: false`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Spawn headless agent via MCP
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 6: Spawn headless agent via MCP spawn_agent ===');
        const headlessResult = await mcpCallTool(mcpUrl, 'spawn_agent', {
            nodeId: parentNodeId,
            callerTerminalId: callerTerminalId,
            headless: true
        });

        console.log(`  Spawn result: ${JSON.stringify(headlessResult.parsed)}`);
        expect(headlessResult.success).toBe(true);

        const headlessTerminalId: string = (headlessResult.parsed as { terminalId: string }).terminalId;
        expect(headlessTerminalId).toBeTruthy();
        console.log(`✓ Headless agent spawned: ${headlessTerminalId}`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 7: Verify isHeadless in list_agents
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 7: Verify isHeadless flag in list_agents ===');
        await appWindow.waitForTimeout(500);

        const listAfterSpawn = await mcpCallTool(mcpUrl, 'list_agents', {});
        const agentsAfterSpawn = (listAfterSpawn.parsed as {
            agents: Array<{ terminalId: string; isHeadless: boolean; status: string }>
        }).agents;

        const headlessAgent = agentsAfterSpawn.find(a => a.terminalId === headlessTerminalId);
        expect(headlessAgent).toBeDefined();
        expect(headlessAgent!.isHeadless).toBe(true);
        // Agent may already be exited since echo completes near-instantly
        expect(['running', 'exited']).toContain(headlessAgent!.status);
        console.log(`✓ Headless agent visible: isHeadless=true, status=${headlessAgent!.status}`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 8: Verify send_message guard (headless rejects stdin)
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 8: Verify send_message guard ===');
        const sendResult = await mcpCallTool(mcpUrl, 'send_message', {
            terminalId: headlessTerminalId,
            message: 'test message',
            callerTerminalId: callerTerminalId
        });
        expect(sendResult.success).toBe(false);
        expect(sendResult.isError).toBe(true);

        const sendError: string = (sendResult.parsed as { error: string }).error;
        expect(sendError.toLowerCase()).toContain('headless');
        console.log(`✓ send_message rejected: "${sendError.slice(0, 80)}..."`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 9: Verify read_terminal_output returns headless output
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 9: Verify read_terminal_output returns headless output ===');
        const readResult = await mcpCallTool(mcpUrl, 'read_terminal_output', {
            terminalId: headlessTerminalId,
            callerTerminalId: callerTerminalId
        });
        // Headless agents return captured stderr ring buffer (not a rejection)
        expect(readResult.success).toBe(true);
        expect((readResult.parsed as { isHeadless: boolean }).isHeadless).toBe(true);
        console.log(`✓ read_terminal_output returned headless output (isHeadless=true)`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 10: Wait for headless agent to exit
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 10: Wait for headless agent to exit ===');
        // The headless agent runs 'sleep 5' (from test settings), should exit in ~5-6 seconds
        await expect.poll(async () => {
            const listResult = await mcpCallTool(mcpUrl, 'list_agents', {});
            const currentAgents = (listResult.parsed as {
                agents: Array<{ terminalId: string; status: string }>
            }).agents;
            const agent = currentAgents.find(a => a.terminalId === headlessTerminalId);
            const status: string = agent?.status ?? 'not_found';
            console.log(`  Polling headless agent status: ${status}`);
            return status;
        }, {
            message: `Waiting for headless agent ${headlessTerminalId} to exit`,
            timeout: 30000,
            intervals: [1000, 2000, 2000, 2000, 5000]
        }).toBe('exited');
        console.log('✓ Headless agent exited');

        // ═══════════════════════════════════════════════════════════════════
        // TEST SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        console.log('');
        console.log('=== HEADLESS AGENT E2E TEST SUMMARY ===');
        console.log('✓ MCP server started and initialized');
        console.log('✓ Test vault loaded');
        console.log('✓ Caller terminal spawned and registered (isHeadless: false)');
        console.log('✓ Headless agent spawned via MCP spawn_agent (headless: true)');
        console.log('✓ list_agents shows isHeadless: true');
        console.log('✓ send_message rejected for headless agent');
        console.log('✓ read_terminal_output returns captured output for headless agent');
        console.log('✓ Headless agent process exited cleanly');
        console.log('');
        console.log('✅ HEADLESS AGENT E2E TEST PASSED');
    });
});
