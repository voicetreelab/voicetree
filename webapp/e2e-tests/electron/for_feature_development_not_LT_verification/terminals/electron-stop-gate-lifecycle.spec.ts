/**
 * E2E Test: Stop Gate Lifecycle — Full Audit → Resume/Block Cycle (BF-024)
 *
 * Proves the stop gate audit fires end-to-end with REAL CLI agents (Claude, Codex).
 * Each test spawns a real agent on a task node referencing a test SKILL.md with
 * outgoing edges (one hard, one soft). The agent exits without creating progress
 * nodes or spawning children, triggering the audit.
 *
 * Headless tests: audit fires on process exit → detects violations → resumes
 * agent with deficiency prompt via --resume. Assert terminal output contains
 * "STOP GATE AUDIT FAILED".
 *
 * Non-headless tests: agent finishes work → close_agent self-close is called →
 * audit blocks the close with violation details. Assert close_agent response
 * contains audit failure.
 *
 * NOTE: Non-headless tests require updateStopGateFields to be called in the
 * interactive branch of spawnTerminalWithContextNode.ts (currently only called
 * in the headless branch at line 162-167). Until that gap is fixed, the
 * non-headless tests will fail because skillPath is null for interactive agents.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT: string = path.resolve(process.cwd());

// The test SKILL.md is written to ~/brain/workflows/ at runtime so runStopGateAudit can resolve it.
// resolveSkillPath matches ~/brain/.../SKILL.md in task node content.
// runStopGateAudit resolves ~/brain/ → $HOME/brain/ and reads the file.
const SKILL_FIXTURE_RELATIVE: string = 'workflows/_e2e-stop-gate-test/SKILL.md';
const SKILL_BRAIN_REF: string = `~/brain/${SKILL_FIXTURE_RELATIVE}`;

const SKILL_FIXTURE_CONTENT: string = [
    '# Test Stop Gate Skill',
    '',
    '## Outgoing Workflows',
    '[[~/brain/workflows/test-hard-edge/SKILL.md]]',
    '[~/brain/workflows/test-soft-edge/SKILL.md]',
    ''
].join('\n');

// ─── CLI binary detection ────────────────────────────────────────────────────

function hasCliTool(name: string): boolean {
    try {
        execSync(`which ${name}`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

// ─── Window type for Playwright evaluate ─────────────────────────────────────

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

// ─── Electron + SKILL.md fixture ─────────────────────────────────────────────

/**
 * Creates a temp vault with a task node that references the test SKILL.md,
 * writes the SKILL.md to ~/brain/ so the audit can resolve it,
 * and launches Electron pointed at the temp vault.
 */
const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    fixtureVaultPath: string;
}>({
    fixtureVaultPath: async ({}, use) => {
        // Create temp vault with a task node referencing the test SKILL.md
        const tempVaultPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-stop-gate-lifecycle-vault-'));
        const voicetreeDir: string = path.join(tempVaultPath, 'voicetree');
        await fs.mkdir(voicetreeDir, { recursive: true });

        // Task node whose content contains the ~/brain/...SKILL.md reference.
        // resolveSkillPath parses this to set skillPath on the terminal record.
        const taskNodeContent: string = [
            '---',
            'isContextNode: false',
            '---',
            '# E2E Stop Gate Lifecycle Test',
            '',
            `This task uses ${SKILL_BRAIN_REF} for workflow enforcement.`,
            '',
            'Reply with OK and exit immediately. Do not create any files, nodes, or agents.',
            ''
        ].join('\n');
        await fs.writeFile(path.join(voicetreeDir, 'stop-gate-lifecycle-task.md'), taskNodeContent);

        // Write the SKILL.md to ~/brain/ so runStopGateAudit can resolve and read it
        const brainDir: string = path.join(os.homedir(), 'brain');
        const skillAbsolutePath: string = path.join(brainDir, SKILL_FIXTURE_RELATIVE);
        await fs.mkdir(path.dirname(skillAbsolutePath), { recursive: true });
        await fs.writeFile(skillAbsolutePath, SKILL_FIXTURE_CONTENT);

        await use(tempVaultPath);

        // Cleanup: remove test SKILL.md from ~/brain/
        try {
            await fs.rm(path.dirname(skillAbsolutePath), { recursive: true, force: true });
        } catch {
            console.log('[Stop Gate Lifecycle] Note: Could not clean up test SKILL.md');
        }
        // Cleanup: remove temp vault
        try {
            await fs.rm(tempVaultPath, { recursive: true, force: true });
        } catch {
            console.log('[Stop Gate Lifecycle] Note: Could not clean up temp vault');
        }
    },

    electronApp: async ({ fixtureVaultPath }, use) => {
        const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-stop-gate-lifecycle-e2e-'));

        const projectsPath: string = path.join(tempUserDataPath, 'projects.json');
        const savedProject = {
            id: 'stop-gate-lifecycle-test',
            path: fixtureVaultPath,
            name: 'stop-gate-lifecycle-vault',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true
        };
        await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

        const configPath: string = path.join(tempUserDataPath, 'voicetree-config.json');
        await fs.writeFile(configPath, JSON.stringify({ lastDirectory: fixtureVaultPath }, null, 2), 'utf8');

        // Settings: both Claude and Codex agents.
        // --dangerously-skip-permissions / --full-auto prevents permission prompts in headless mode.
        const settingsPath: string = path.join(tempUserDataPath, 'settings.json');
        await fs.writeFile(settingsPath, JSON.stringify({
            agents: [
                { name: 'Claude Sonnet', command: 'claude --model claude-sonnet-4-20250514 --dangerously-skip-permissions "$AGENT_PROMPT"' },
                { name: 'Codex', command: 'codex --full-auto "$AGENT_PROMPT"' }
            ],
            terminalSpawnPathRelativeToWatchedDirectory: '/'
        }, null, 2), 'utf8');

        console.log('[Stop Gate Lifecycle] Temp userData:', tempUserDataPath);
        console.log('[Stop Gate Lifecycle] Vault:', fixtureVaultPath);

        const electronApp: ElectronApplication = await electron.launch({
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
            const window: Page = await electronApp.firstWindow();
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
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp }, use) => {
        console.log('=== Getting app window ===');
        const window: Page = await electronApp.firstWindow({ timeout: 60000 });

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
            console.log('[Stop Gate Lifecycle] Cytoscape initialized via auto-load');
        } catch {
            console.log('[Stop Gate Lifecycle] Auto-load timed out, clicking project...');
            const projectButton = window.locator('button').filter({ hasText: 'stop-gate-lifecycle-vault' });
            await expect(projectButton.first()).toBeVisible({ timeout: 10000 });
            await projectButton.first().click();

            await window.waitForFunction(
                () => (window as unknown as ExtendedWindow).cytoscapeInstance,
                { timeout: 30000 }
            );
            console.log('[Stop Gate Lifecycle] Cytoscape initialized after project selection');
        }

        await window.waitForTimeout(1000);
        await use(window);
    }
});

// ─── MCP HTTP Helpers ────────────────────────────────────────────────────────

async function waitForMcpServer(mcpUrl: string, maxRetries = 20, delayMs = 1000): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response: Response = await fetch(mcpUrl, {
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
                console.log(`[Stop Gate Lifecycle] MCP server available after ${i + 1} attempts`);
                return true;
            }
        } catch {
            if (i % 5 === 0) console.log(`[Stop Gate Lifecycle] MCP server not ready, attempt ${i + 1}/${maxRetries}`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return false;
}

async function mcpRequest(mcpUrl: string, method: string, params: Record<string, unknown> = {}, id = 1): Promise<unknown> {
    const response: Response = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    });
    const text: string = await response.text();
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

// ─── Shared setup helpers ────────────────────────────────────────────────────

/** Bootstrap MCP connection + wait for graph. Returns mcpUrl and parentNodeId. */
async function setupMcpAndGraph(appWindow: Page): Promise<{ mcpUrl: string; parentNodeId: string }> {
    // Discover MCP port
    const mcpPort: number = await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        return await api.main.getMcpPort();
    });
    const mcpUrl: string = `http://127.0.0.1:${mcpPort}/mcp`;
    console.log(`[Stop Gate Lifecycle] MCP port: ${mcpPort}`);

    // Wait for MCP server
    const serverReady: boolean = await waitForMcpServer(mcpUrl, 20, 1000);
    if (!serverReady) throw new Error('MCP server not available');

    await mcpRequest(mcpUrl, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'stop-gate-lifecycle-e2e', version: '1.0.0' }
    });

    // Wait for graph to load
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

    // Find the task node (our stop-gate-lifecycle-task.md)
    const nodeIds: string[] = await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        const graph = await api.main.getGraph();
        return Object.keys(graph.nodes);
    });
    expect(nodeIds.length).toBeGreaterThan(0);

    // Find the task node that references the test SKILL.md
    const parentNodeId: string = nodeIds.find(id => id.includes('stop-gate-lifecycle-task')) ?? nodeIds[0];
    console.log(`[Stop Gate Lifecycle] Using task node: ${parentNodeId.split('/').pop()}`);

    return { mcpUrl, parentNodeId };
}

/** Register a caller terminal so spawn_agent has a valid callerTerminalId. */
async function registerCallerTerminal(appWindow: Page, parentNodeId: string, callerId: string): Promise<void> {
    const spawnResult = await appWindow.evaluate(async ({ nodeId, callerId: cid }) => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api?.terminal) throw new Error('electronAPI.terminal not available');

        return await api.terminal.spawn({
            type: 'Terminal',
            terminalId: cid,
            attachedToContextNodeId: nodeId,
            terminalCount: 0,
            title: 'E2E Stop Gate Lifecycle Caller',
            anchoredToNodeId: { _tag: 'None' },
            shadowNodeDimensions: { width: 600, height: 400 },
            resizable: true,
            initialCommand: 'sleep 300',
            executeCommand: true,
            isPinned: true,
            isDone: false,
            lastOutputTime: Date.now(),
            activityCount: 0,
            parentTerminalId: null,
            agentName: cid,
            worktreeName: undefined,
            isHeadless: false
        });
    }, { nodeId: parentNodeId, callerId });

    expect(spawnResult.success).toBe(true);
    await appWindow.waitForTimeout(1000);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Stop Gate Lifecycle E2E (BF-024)', () => {
    test.describe.configure({ mode: 'serial', timeout: 300000 });

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 1: Claude headless — audit fires on exit, resumes with deficiency
    // ═══════════════════════════════════════════════════════════════════════
    test('Claude headless — audit fires on exit and resumes with deficiency', async ({ appWindow }) => {
        test.skip(!hasCliTool('claude'), 'claude CLI not found — skipping');

        console.log('=== TEST 1: Claude headless — audit fires on exit ===');

        const { mcpUrl, parentNodeId } = await setupMcpAndGraph(appWindow);
        const callerTerminalId: string = 'e2e-stop-gate-claude-headless-caller';
        await registerCallerTerminal(appWindow, parentNodeId, callerTerminalId);

        // ── Spawn headless Claude agent on the task node ──
        // The task node content contains ~/brain/workflows/_e2e-stop-gate-test/SKILL.md
        // so resolveSkillPath will set skillPath on the terminal record.
        // The agent gets a trivial prompt and should exit quickly.
        console.log('=== Spawning headless Claude agent ===');
        const spawnResult = await mcpCallTool(mcpUrl, 'spawn_agent', {
            nodeId: parentNodeId,
            callerTerminalId,
            agentName: 'Claude Sonnet',
            headless: true
        });

        console.log(`[Claude Headless] Spawn result: ${JSON.stringify(spawnResult.parsed)}`);
        expect(spawnResult.success).toBe(true);

        const agentTerminalId: string = (spawnResult.parsed as { terminalId: string }).terminalId;
        expect(agentTerminalId).toBeTruthy();
        console.log(`[Claude Headless] Agent terminal: ${agentTerminalId}`);

        // ── Wait for the full audit→resume cycle to complete ──
        // The agent exits → audit fires → detects violations → resumes with deficiency.
        // This repeats up to 3 times. After max retries, agent stays exited.
        // Allow generous timeout for up to 3 resume cycles with real Claude.
        console.log('=== Waiting for agent to complete audit cycle (up to 3 retries) ===');
        await expect.poll(async () => {
            const result = await mcpCallTool(mcpUrl, 'list_agents', {});
            const agents = (result.parsed as {
                agents: Array<{ terminalId: string; status: string }>
            }).agents;
            const agent = agents.find(a => a.terminalId === agentTerminalId);
            const status: string = agent?.status ?? 'not_found';
            console.log(`[Claude Headless] Polling status: ${status}`);
            return status;
        }, {
            message: `Waiting for ${agentTerminalId} to reach final exited state after audit retries`,
            timeout: 240000,
            intervals: [2000, 5000, 5000, 10000, 10000]
        }).toBe('exited');
        console.log('[Claude Headless] Agent reached final exited state');

        // ── Read terminal output — should contain deficiency prompt from resume ──
        // The resume injects RESUME_PROMPT env var containing "STOP GATE AUDIT FAILED".
        // Claude receives this via -p "$RESUME_PROMPT" and its output is captured.
        console.log('=== Reading terminal output ===');
        const readResult = await mcpCallTool(mcpUrl, 'read_terminal_output', {
            terminalId: agentTerminalId,
            callerTerminalId
        });
        expect(readResult.success).toBe(true);

        const output: string = (readResult.parsed as { output: string }).output ?? '';
        console.log(`[Claude Headless] Output length: ${output.length} chars`);
        console.log(`[Claude Headless] Output (last 500): ${output.slice(-500)}`);

        // ASSERT: output contains the deficiency prompt injected on resume.
        // The RESUME_PROMPT ("STOP GATE AUDIT FAILED...") is passed to claude via
        // -p "$RESUME_PROMPT". Claude's output should reference the audit failure.
        expect(output).toContain('STOP GATE AUDIT FAILED');

        console.log('[PASS] Claude headless: audit fired and resume injected deficiency prompt');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 2: Claude non-headless — audit fires on self-close
    // ═══════════════════════════════════════════════════════════════════════
    //
    // NOTE: This test currently requires a fix to spawnTerminalWithContextNode.ts
    // to call updateStopGateFields in the interactive branch (lines 168+).
    // Currently skillPath is only set for headless agents (line 162-167).
    // Without that fix, closeAgentTool.ts:34 checks selfRecord?.skillPath which
    // is null, so the audit is skipped and close succeeds without enforcement.
    //
    test('Claude non-headless — audit fires on self-close', async ({ appWindow }) => {
        test.skip(!hasCliTool('claude'), 'claude CLI not found — skipping');

        console.log('=== TEST 2: Claude non-headless — audit fires on self-close ===');

        const { mcpUrl, parentNodeId } = await setupMcpAndGraph(appWindow);
        const callerTerminalId: string = 'e2e-stop-gate-claude-interactive-caller';
        await registerCallerTerminal(appWindow, parentNodeId, callerTerminalId);

        // ── Spawn interactive Claude agent ──
        console.log('=== Spawning interactive Claude agent ===');
        const spawnResult = await mcpCallTool(mcpUrl, 'spawn_agent', {
            nodeId: parentNodeId,
            callerTerminalId,
            agentName: 'Claude Sonnet',
            headless: false
        });

        console.log(`[Claude Interactive] Spawn result: ${JSON.stringify(spawnResult.parsed)}`);
        expect(spawnResult.success).toBe(true);

        const agentTerminalId: string = (spawnResult.parsed as { terminalId: string }).terminalId;
        expect(agentTerminalId).toBeTruthy();
        console.log(`[Claude Interactive] Agent terminal: ${agentTerminalId}`);

        // ── Wait for agent to become idle ──
        // Interactive agents go idle when they stop producing output.
        // list_agents reports status: 'idle' when isDone is true.
        console.log('=== Waiting for interactive agent to become idle ===');
        await expect.poll(async () => {
            const result = await mcpCallTool(mcpUrl, 'list_agents', {});
            const agents = (result.parsed as {
                agents: Array<{ terminalId: string; status: string }>
            }).agents;
            const agent = agents.find(a => a.terminalId === agentTerminalId);
            const status: string = agent?.status ?? 'not_found';
            console.log(`[Claude Interactive] Polling status: ${status}`);
            return status;
        }, {
            message: `Waiting for ${agentTerminalId} to become idle`,
            timeout: 120000,
            intervals: [2000, 5000, 5000, 10000]
        }).toBe('idle');
        console.log('[Claude Interactive] Agent is idle');

        // ── Call close_agent with self-close semantics ──
        // Simulates the agent calling close_agent on itself.
        // closeAgentTool.ts:29-43 runs stop gate audit on self-close when skillPath is set.
        console.log('=== Calling close_agent (self-close) ===');
        const closeResult = await mcpCallTool(mcpUrl, 'close_agent', {
            terminalId: agentTerminalId,
            callerTerminalId: agentTerminalId  // self-close: caller === target
        });

        console.log(`[Claude Interactive] Close result: ${JSON.stringify(closeResult.parsed)}`);

        // ASSERT: close_agent should FAIL because stop gate audit detected violations.
        // The agent created no progress nodes and didn't spawn children for the hard edge.
        expect(closeResult.success).toBe(false);
        const closeError: string = (closeResult.parsed as { error: string }).error ?? '';
        expect(closeError).toContain('Stop gate audit failed');
        expect(closeError).toContain('Hard edge violation');

        console.log('[PASS] Claude non-headless: audit blocked self-close with violation details');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 3: Codex headless — audit fires on exit, resumes with deficiency
    // ═══════════════════════════════════════════════════════════════════════
    test('Codex headless — audit fires on exit and resumes with deficiency', async ({ appWindow }) => {
        test.skip(!hasCliTool('codex'), 'codex CLI not found — skipping');

        console.log('=== TEST 3: Codex headless — audit fires on exit ===');

        const { mcpUrl, parentNodeId } = await setupMcpAndGraph(appWindow);
        const callerTerminalId: string = 'e2e-stop-gate-codex-headless-caller';
        await registerCallerTerminal(appWindow, parentNodeId, callerTerminalId);

        // ── Spawn headless Codex agent ──
        // Codex doesn't require sessionId for shouldRunAudit (only Claude does).
        // shouldRunAudit returns true for codex with just skillPath + cliType.
        console.log('=== Spawning headless Codex agent ===');
        const spawnResult = await mcpCallTool(mcpUrl, 'spawn_agent', {
            nodeId: parentNodeId,
            callerTerminalId,
            agentName: 'Codex',
            headless: true
        });

        console.log(`[Codex Headless] Spawn result: ${JSON.stringify(spawnResult.parsed)}`);
        expect(spawnResult.success).toBe(true);

        const agentTerminalId: string = (spawnResult.parsed as { terminalId: string }).terminalId;
        expect(agentTerminalId).toBeTruthy();
        console.log(`[Codex Headless] Agent terminal: ${agentTerminalId}`);

        // ── Wait for full audit→resume cycle ──
        // Codex exits → audit fires → violations detected → resume with deficiency.
        // Codex resume command: codex exec resume --last -p "$RESUME_PROMPT" --full-auto
        console.log('=== Waiting for agent to complete audit cycle ===');
        await expect.poll(async () => {
            const result = await mcpCallTool(mcpUrl, 'list_agents', {});
            const agents = (result.parsed as {
                agents: Array<{ terminalId: string; status: string }>
            }).agents;
            const agent = agents.find(a => a.terminalId === agentTerminalId);
            const status: string = agent?.status ?? 'not_found';
            console.log(`[Codex Headless] Polling status: ${status}`);
            return status;
        }, {
            message: `Waiting for ${agentTerminalId} to reach final exited state after audit retries`,
            timeout: 240000,
            intervals: [2000, 5000, 5000, 10000, 10000]
        }).toBe('exited');
        console.log('[Codex Headless] Agent reached final exited state');

        // ── Read terminal output ──
        console.log('=== Reading terminal output ===');
        const readResult = await mcpCallTool(mcpUrl, 'read_terminal_output', {
            terminalId: agentTerminalId,
            callerTerminalId
        });
        expect(readResult.success).toBe(true);

        const output: string = (readResult.parsed as { output: string }).output ?? '';
        console.log(`[Codex Headless] Output length: ${output.length} chars`);
        console.log(`[Codex Headless] Output (last 500): ${output.slice(-500)}`);

        // ASSERT: output contains the deficiency prompt from resume
        expect(output).toContain('STOP GATE AUDIT FAILED');

        console.log('[PASS] Codex headless: audit fired and resume injected deficiency prompt');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 4: Codex non-headless — audit fires on self-close
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Same gap as Test 2: updateStopGateFields not called for interactive agents.
    //
    test('Codex non-headless — audit fires on self-close', async ({ appWindow }) => {
        test.skip(!hasCliTool('codex'), 'codex CLI not found — skipping');

        console.log('=== TEST 4: Codex non-headless — audit fires on self-close ===');

        const { mcpUrl, parentNodeId } = await setupMcpAndGraph(appWindow);
        const callerTerminalId: string = 'e2e-stop-gate-codex-interactive-caller';
        await registerCallerTerminal(appWindow, parentNodeId, callerTerminalId);

        // ── Spawn interactive Codex agent ──
        console.log('=== Spawning interactive Codex agent ===');
        const spawnResult = await mcpCallTool(mcpUrl, 'spawn_agent', {
            nodeId: parentNodeId,
            callerTerminalId,
            agentName: 'Codex',
            headless: false
        });

        console.log(`[Codex Interactive] Spawn result: ${JSON.stringify(spawnResult.parsed)}`);
        expect(spawnResult.success).toBe(true);

        const agentTerminalId: string = (spawnResult.parsed as { terminalId: string }).terminalId;
        expect(agentTerminalId).toBeTruthy();
        console.log(`[Codex Interactive] Agent terminal: ${agentTerminalId}`);

        // ── Wait for agent to become idle ──
        console.log('=== Waiting for interactive agent to become idle ===');
        await expect.poll(async () => {
            const result = await mcpCallTool(mcpUrl, 'list_agents', {});
            const agents = (result.parsed as {
                agents: Array<{ terminalId: string; status: string }>
            }).agents;
            const agent = agents.find(a => a.terminalId === agentTerminalId);
            const status: string = agent?.status ?? 'not_found';
            console.log(`[Codex Interactive] Polling status: ${status}`);
            return status;
        }, {
            message: `Waiting for ${agentTerminalId} to become idle`,
            timeout: 120000,
            intervals: [2000, 5000, 5000, 10000]
        }).toBe('idle');
        console.log('[Codex Interactive] Agent is idle');

        // ── Call close_agent with self-close semantics ──
        console.log('=== Calling close_agent (self-close) ===');
        const closeResult = await mcpCallTool(mcpUrl, 'close_agent', {
            terminalId: agentTerminalId,
            callerTerminalId: agentTerminalId  // self-close: caller === target
        });

        console.log(`[Codex Interactive] Close result: ${JSON.stringify(closeResult.parsed)}`);

        // ASSERT: close should fail due to stop gate audit violations
        expect(closeResult.success).toBe(false);
        const closeError: string = (closeResult.parsed as { error: string }).error ?? '';
        expect(closeError).toContain('Stop gate audit failed');
        expect(closeError).toContain('Hard edge violation');

        console.log('[PASS] Codex non-headless: audit blocked self-close with violation details');
    });
});
