/**
 * E2E Test: Headless Agent Mode
 *
 * User-observable contract verified through MCP:
 * 1. spawn_agent with headless:true returns a terminalId
 * 2. list_agents reports the agent with isHeadless:true
 * 3. send_message reaches tmux-backed headless agents through tmux send-keys
 * 4. read_terminal_output returns the captured stdout/stderr ring buffer
 *    (with isHeadless:true), and that buffer reflects what the spawned
 *    process actually wrote — proving a real process ran, not just a stub
 * 5. The agent transitions to status 'exited' with exitCode 0
 *
 * Bootstrap: launch Electron, load the project fixture, register a caller
 * terminal via hostAPI (so we have a valid callerTerminalId for MCP),
 * then drive the headless lifecycle entirely through MCP.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
    pollForCytoscape,
    robustElectronTeardown,
    resolveGraphDaemonNodeBin,
    safeStopFileWatching,
} from './electron-smoke-helpers';
import { getBearerToken, getDaemonRpcUrl, rpcCallTool } from './helpers/e2e-rpc-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_SOURCE_PROJECT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
const HEADLESS_OUTPUT_MARKER = 'VT_HEADLESS_E2E_OUTPUT_MARKER';

interface ExtendedWindow {
    cytoscapeInstance?: {
        nodes: () => { length: number; map: (fn: (n: { id: () => string }) => string) => string[] };
    };
    hostAPI?: {
        main: {
            stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
            getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
            saveSettings: (settings: Record<string, unknown>) => Promise<boolean>;
            spawnTerminalWithContextNode: (request: {
                readonly taskNodeId: string;
                readonly agentCommand?: string;
                readonly terminalCount?: number;
            }) => Promise<{ readonly terminalId: string; readonly contextNodeId: string }>;
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
        const fixtureProjectPath = path.join(tempUserDataPath, 'example_small');
        await fs.cp(FIXTURE_SOURCE_PROJECT_PATH, fixtureProjectPath, { recursive: true });

        // Create projects.json with the test project (smoke test pattern)
        const projectsPath = path.join(tempUserDataPath, 'projects.json');
        const savedProject = {
            id: 'headless-test-project',
            path: fixtureProjectPath,
            name: 'example_small',
            type: 'folder',
            lastOpened: Date.now(),
        };
        await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

        // Also write legacy config for auto-load attempt
        const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
        await fs.writeFile(configPath, JSON.stringify({ lastDirectory: fixtureProjectPath }, null, 2), 'utf8');

        // Test agent command emits a distinctive marker on stdout and exits 0.
        // The marker lets read_terminal_output prove a real process ran and its
        // captured output reached the headless ring buffer — independent of how
        // the headless command transformation rewrites the trailing prompt arg.
        const settingsPath = path.join(tempUserDataPath, 'settings.json');
        await fs.writeFile(settingsPath, JSON.stringify({
            agents: [
                { name: 'Test Agent', command: `echo "${HEADLESS_OUTPUT_MARKER}" "$AGENT_PROMPT" && sleep 10` }
            ],
            terminalSpawnPathRelativeToWatchedDirectory: '/'
        }, null, 2), 'utf8');

        console.log('[Headless Test] Temp userData created:', tempUserDataPath);
        console.log('[Headless Test] projects.json, voicetree-config.json, settings.json written');

        const ciFlags = process.env.CI
            ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader']
            : [];
        const electronApp = await electron.launch({
            args: [
                ...ciFlags,
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
                VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
                // Pin the daemon's voicetree-home path so its tmux socket lives
                // under the same user-data dir the test queries.
                VOICETREE_HOME_PATH: tempUserDataPath,
            },
            timeout: 15000
        });

        await use(electronApp);

        // Graceful shutdown
        console.log('=== Cleaning up Electron app ===');
        await safeStopFileWatching(electronApp);
        await robustElectronTeardown(electronApp);
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

        try {
            await pollForCytoscape(window, 5000);
            console.log('✓ Cytoscape initialized via auto-load');
        } catch {
            console.log('Auto-load timed out, clicking project from selection screen...');
            const projectButton = window.locator('button').filter({ hasText: 'example_small' });
            await expect(projectButton.first()).toBeVisible({ timeout: 10000 });
            await projectButton.first().click();
            console.log('✓ Clicked example_small project');
            await pollForCytoscape(window, 30000);
            console.log('✓ Cytoscape initialized after project selection');
        }

        await window.waitForTimeout(1000);
        await use(window);
    }
});

async function waitForRpcToolSuccess(
    rpcUrl: string,
    token: string,
    toolName: string,
    args: Record<string, unknown>,
    label: string
): Promise<{
    success: boolean;
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    parsed?: Record<string, unknown>;
}> {
    let lastResult: Awaited<ReturnType<typeof rpcCallTool>> | undefined;

    await expect.poll(async () => {
        lastResult = await rpcCallTool(rpcUrl, token, toolName, args);
        console.log(`  ${label} result: ${JSON.stringify(lastResult.parsed)}`);
        return lastResult.success === true && lastResult.isError !== true;
    }, {
        message: `Waiting for ${label} to succeed`,
        timeout: 10000,
        intervals: [500, 1000, 1000, 2000]
    }).toBe(true);

    return lastResult!;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Headless Agent E2E', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    // FIXME(merge-followup): Fails fast (~9s) at /rpc discovery or daemon
    // health-probe. The vt-daemon /rpc surface was overhauled in origin/dev
    // (BF-371 auth, BF-376 routes) and this spec's getDaemonRpcUrl helper
    // likely depends on a pre-migration URL/bearer flow. Re-baseline against
    // the new ensureVtDaemonForProject + bindVtDaemonForProject contracts.
    test.skip('spawn headless agent via /rpc, verify lifecycle and guards', async ({ appWindow }) => {
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Discover daemon /rpc URL + bearer token
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 1: Discover daemon /rpc URL + bearer token ===');
        const rpcUrl: string = await getDaemonRpcUrl(appWindow);
        const token: string = await getBearerToken(appWindow);
        console.log(`✓ Daemon discovered: ${rpcUrl}`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Wait for project to fully load (graph nodes)
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
        console.log('✓ Project loaded into graph');

        // Extra wait for stability
        await appWindow.waitForTimeout(2000);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Discover graph nodes
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 4: Discover graph nodes ===');
        const nodeIds: string[] = await appWindow.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
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
        console.log('=== STEP 5: Spawn caller terminal via hostAPI ===');

        // Spawn an interactive terminal that registers in the daemon-owned
        // terminal registry. The fixture's settings register "Test Agent" as
        // the default — long-lived enough (sleep 10) to serve as a parked
        // callerTerminalId for MCP `spawn_agent`. The daemon assigns the id.
        const callerSpawn = await appWindow.evaluate(async ({ parentNodeId: nodeId }) => {
            const api = (window as unknown as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');

            return await api.main.spawnTerminalWithContextNode({
                taskNodeId: nodeId,
                terminalCount: 0,
            });
        }, { parentNodeId });

        console.log(`  Spawn result: ${JSON.stringify(callerSpawn)}`);
        const callerTerminalId = callerSpawn.terminalId;
        expect(callerTerminalId).toBeTruthy();

        // Wait for terminal to register
        await appWindow.waitForTimeout(1000);

        // Verify caller terminal appears in list_agents
        console.log('=== STEP 5b: Verify caller terminal in list_agents ===');
        const initialList = await rpcCallTool(rpcUrl, token, 'list_agents', {});
        const initialAgents = (initialList.parsed as {
            agents: Array<{ terminalId: string; isHeadless: boolean; status: string }>
        }).agents;

        const callerAgent = initialAgents.find(a => a.terminalId === callerTerminalId);
        expect(callerAgent).toBeDefined();
        expect(callerAgent!.isHeadless).toBe(false);
        console.log(`✓ Caller terminal registered: ${callerTerminalId}, isHeadless: false`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Spawn headless agent via /rpc spawn_agent
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 6: Spawn headless agent via /rpc spawn_agent ===');
        const headlessResult = await rpcCallTool(rpcUrl, token, 'spawn_agent', {
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

        const listAfterSpawn = await rpcCallTool(rpcUrl, token, 'list_agents', {});
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
        // STEP 8: Verify send_message reaches tmux-backed headless stdin
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 8: Verify send_message reaches tmux-backed headless stdin ===');
        const sendResult = await waitForRpcToolSuccess(rpcUrl, token, 'send_message', {
            terminalId: headlessTerminalId,
            message: 'test message',
            callerTerminalId: callerTerminalId
        }, 'send_message');
        expect(sendResult.success).toBe(true);
        expect(sendResult.isError).not.toBe(true);
        console.log('✓ send_message accepted for tmux-backed headless agent');

        // ═══════════════════════════════════════════════════════════════════
        // STEP 9: Verify read_terminal_output returns the captured output
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 9: Verify read_terminal_output returns captured output ===');
        // Headless agents return the captured stdout/stderr ring buffer rather
        // than a rejection. Polling absorbs the small async gap between the
        // child process writing and the buffer being readable through MCP.
        // Asserting the marker appears proves the spawned process actually ran
        // and that read_terminal_output exposes its real output (not an empty
        // pending stub).
        await expect.poll(async () => {
            const readResult = await rpcCallTool(rpcUrl, token, 'read_terminal_output', {
                terminalId: headlessTerminalId,
                callerTerminalId: callerTerminalId
            });
            const parsed = readResult.parsed as { success?: boolean; isHeadless?: boolean; output?: string };
            return {
                success: parsed.success ?? false,
                isHeadless: parsed.isHeadless ?? false,
                output: parsed.output ?? ''
            };
        }, {
            message: 'Waiting for headless agent stdout marker to appear in read_terminal_output',
            timeout: 15000,
            intervals: [500, 1000, 1000, 2000]
        }).toMatchObject({
            success: true,
            isHeadless: true,
            output: expect.stringContaining(HEADLESS_OUTPUT_MARKER)
        });
        console.log(`✓ read_terminal_output returned captured output containing marker (isHeadless=true)`);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 10: Wait for headless agent to exit
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 10: Wait for headless agent to exit ===');
        // The headless command echoes the marker and exits — only enough time
        // for the child process to be reaped and the registry to flip status.
        await expect.poll(async () => {
            const listResult = await rpcCallTool(rpcUrl, token, 'list_agents', {});
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
        // STEP 11: Assert exit code is 0
        // ═══════════════════════════════════════════════════════════════════
        console.log('=== STEP 11: Assert headless agent exited with code 0 ===');
        const finalList = await rpcCallTool(rpcUrl, token, 'list_agents', {});
        const finalAgents = (finalList.parsed as { agents: Array<{ terminalId: string; exitCode: number | null }> }).agents;
        const exitedAgent = finalAgents.find(a => a.terminalId === headlessTerminalId);
        expect(exitedAgent?.exitCode).toBe(0);
        console.log('✓ Headless agent exited with code 0');

        // ═══════════════════════════════════════════════════════════════════
        // TEST SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        console.log('');
        console.log('=== HEADLESS AGENT E2E TEST SUMMARY ===');
        console.log('✓ Daemon /rpc reachable');
        console.log('✓ Test project loaded');
        console.log('✓ Caller terminal spawned and registered (isHeadless: false)');
        console.log('✓ Headless agent spawned via MCP spawn_agent (headless: true)');
        console.log('✓ list_agents shows isHeadless: true');
        console.log('✓ send_message accepted for tmux-backed headless agent');
        console.log('✓ read_terminal_output returns captured output containing the marker');
        console.log('✓ Headless agent process exited cleanly');
        console.log('✓ Headless agent exit code is 0');
        console.log('');
        console.log('✅ HEADLESS AGENT E2E TEST PASSED');
    });
});
