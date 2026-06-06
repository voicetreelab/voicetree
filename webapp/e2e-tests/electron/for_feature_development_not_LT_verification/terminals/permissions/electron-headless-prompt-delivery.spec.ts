/**
 * E2E Test: Headless Agent Prompt Delivery via Env Var Expansion
 *
 * Verifies that headless agents receive their prompt via AGENT_PROMPT env var
 * expansion (not the removed --prompt-file flag).
 *
 * Uses an echo agent (`echo "$AGENT_PROMPT"`) to prove:
 * 1. The AGENT_PROMPT env var is set and expanded before the command runs
 * 2. The output contains the expected marker string from INJECT_ENV_VARS
 * 3. No --prompt-file flag is present (the old broken mechanism)
 *
 * Pattern follows electron-stop-gate-audit.spec.ts for Electron fixtures and MCP interaction.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
    getBearerToken,
    getDaemonRpcUrl,
    rpcCallTool,
} from '../../../critical_e2e_verification_tests/helpers/e2e-rpc-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_PROJECT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
    cytoscapeInstance?: {
        nodes: () => { length: number; map: (fn: (n: { id: () => string }) => string) => string[] };
    };
    hostAPI?: {
        main: {
            stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
            getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
            saveSettings: (settings: Record<string, unknown>) => Promise<boolean>;
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
        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-prompt-delivery-e2e-'));

        const projectsPath = path.join(tempUserDataPath, 'projects.json');
        const savedProject = {
            id: 'prompt-delivery-test-project',
            path: FIXTURE_PROJECT_PATH,
            name: 'example_small',
            type: 'folder',
            lastOpened: Date.now(),
        };
        await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

        const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
        await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_PROJECT_PATH }, null, 2), 'utf8');

        // Settings: echo agent that prints $AGENT_PROMPT to stdout.
        // INJECT_ENV_VARS provides the AGENT_PROMPT template with a recognizable marker.
        const settingsPath = path.join(tempUserDataPath, 'settings.json');
        await fs.writeFile(settingsPath, JSON.stringify({
            agents: [
                { name: 'Echo Agent', command: 'echo "$AGENT_PROMPT"' }
            ],
            terminalSpawnPathRelativeToWatchedDirectory: '/',
            INJECT_ENV_VARS: {
                AGENT_PROMPT: 'HEADLESS_PROMPT_TEST_MARKER'
            }
        }, null, 2), 'utf8');

        console.log('[Prompt Delivery Test] Temp userData:', tempUserDataPath);

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

        console.log('=== Cleaning up Electron app ===');
        try {
            const window = await electronApp.firstWindow();
            await window.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).hostAPI;
                if (api) await api.main.stopFileWatching();
            });
            await window.waitForTimeout(300);
        } catch {
            console.log('Note: Could not stop file watching during cleanup');
        }

        await electronApp.close();
        await new Promise(resolve => setTimeout(resolve, 2000));
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

        try {
            await window.waitForFunction(
                () => (window as unknown as ExtendedWindow).cytoscapeInstance,
                { timeout: 5000 }
            );
            console.log('[Prompt Delivery] Cytoscape initialized via auto-load');
        } catch {
            console.log('[Prompt Delivery] Auto-load timed out, clicking project...');
            const projectButton = window.locator('button').filter({ hasText: 'example_small' });
            await expect(projectButton.first()).toBeVisible({ timeout: 10000 });
            await projectButton.first().click();

            await window.waitForFunction(
                () => (window as unknown as ExtendedWindow).cytoscapeInstance,
                { timeout: 30000 }
            );
            console.log('[Prompt Delivery] Cytoscape initialized after project selection');
        }

        await window.waitForTimeout(1000);
        await use(window);
    }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Headless Agent Prompt Delivery', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    test('headless agent receives prompt via env var expansion', async ({ appWindow }) => {
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Discover daemon /rpc + bearer token
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 1: Discover daemon /rpc + bearer token ===');
        const rpcUrl: string = await getDaemonRpcUrl(appWindow);
        const token: string = await getBearerToken(appWindow);
        console.log(`[Prompt Delivery] Daemon: ${rpcUrl}`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Wait for graph to load
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 3: Wait for graph ===');
        await expect.poll(async () => {
            return appWindow.evaluate(() => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                return cy ? cy.nodes().length : 0;
            });
        }, {
            message: 'Waiting for graph nodes',
            timeout: 15000,
            intervals: [500, 1000, 1000]
        }).toBeGreaterThan(0);

        await appWindow.waitForTimeout(2000);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Find a node to anchor the agent
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 4: Find anchor node ===');
        const nodeIds: string[] = await appWindow.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            const graph = await api.main.getGraph();
            return Object.keys(graph.nodes);
        });
        expect(nodeIds.length).toBeGreaterThan(0);

        const parentNodeId: string = nodeIds[0];
        console.log(`[Prompt Delivery] Using node: ${parentNodeId.split('/').pop()}`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Bootstrap a caller terminal
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 5: Bootstrap caller terminal ===');
        const callerTerminalId = 'e2e-prompt-delivery-caller';
        const spawnResult = await appWindow.evaluate(async ({ parentNodeId: nodeId, callerId }) => {
            const api = (window as unknown as ExtendedWindow).hostAPI;
            if (!api?.terminal) throw new Error('hostAPI.terminal not available');

            return await api.terminal.spawn({
                type: 'Terminal',
                terminalId: callerId,
                attachedToContextNodeId: nodeId,
                terminalCount: 0,
                title: 'E2E Prompt Delivery Caller',
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

        expect(spawnResult.success).toBe(true);
        await appWindow.waitForTimeout(1000);
        console.log('[Prompt Delivery] Caller terminal registered');

        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Spawn headless echo agent via MCP
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 6: Spawn headless echo agent ===');
        const headlessResult = await rpcCallTool(rpcUrl, token, 'spawn_agent', {
            nodeId: parentNodeId,
            callerTerminalId: callerTerminalId,
            headless: true
        });

        console.log(`[Prompt Delivery] Spawn result: ${JSON.stringify(headlessResult.parsed)}`);
        expect(headlessResult.success).toBe(true);

        const headlessTerminalId: string = (headlessResult.parsed as { terminalId: string }).terminalId;
        expect(headlessTerminalId).toBeTruthy();
        console.log(`[Prompt Delivery] Headless agent: ${headlessTerminalId}`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 7: Wait for headless agent to exit
        // (echo command exits immediately after printing)
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 7: Wait for agent exit ===');
        await expect.poll(async () => {
            const result = await rpcCallTool(rpcUrl, token, 'list_agents', {});
            const agents = (result.parsed as {
                agents: Array<{ terminalId: string; status: string }>
            }).agents;
            const agent = agents.find(a => a.terminalId === headlessTerminalId);
            return agent?.status ?? 'not_found';
        }, {
            message: `Waiting for ${headlessTerminalId} to exit`,
            timeout: 30000,
            intervals: [500, 1000, 2000, 5000]
        }).toBe('exited');
        console.log('[Prompt Delivery] Agent exited');

        // ═══════════════════════════════════════════════════════════════════
        // STEP 8: Read terminal output and verify prompt delivery
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 8: Verify prompt delivery via output ===');
        const readResult = await rpcCallTool(rpcUrl, token, 'read_terminal_output', {
            terminalId: headlessTerminalId,
            callerTerminalId: callerTerminalId
        });
        expect(readResult.success).toBe(true);

        const output: string = (readResult.parsed as { output: string }).output ?? '';
        console.log(`[Prompt Delivery] Agent output: "${output.trim()}"`);

        // ASSERT: output does NOT contain --prompt-file (the old broken mechanism)
        expect(output).not.toContain('--prompt-file');

        // ASSERT: output contains the marker string from INJECT_ENV_VARS.AGENT_PROMPT
        // This proves the env var was expanded and passed to the echo command
        expect(output).toContain('HEADLESS_PROMPT_TEST_MARKER');

        // ═══════════════════════════════════════════════════════════════════
        // TEST SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        console.log('');
        console.log('=== HEADLESS PROMPT DELIVERY E2E TEST SUMMARY ===');
        console.log('[Pass] Daemon /rpc reachable');
        console.log('[Pass] Project loaded into graph');
        console.log('[Pass] Caller terminal registered');
        console.log('[Pass] Headless echo agent spawned');
        console.log('[Pass] Agent exited successfully');
        console.log('[Pass] Output does NOT contain --prompt-file');
        console.log('[Pass] Output contains HEADLESS_PROMPT_TEST_MARKER');
        console.log('');
        console.log('HEADLESS PROMPT DELIVERY E2E TEST PASSED');
    });
});
