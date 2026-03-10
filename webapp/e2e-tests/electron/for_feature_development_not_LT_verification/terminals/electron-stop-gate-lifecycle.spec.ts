/**
 * E2E Test: Stop Gate Lifecycle — Full Audit → Resume/Block Cycle (BF-024)
 *
 * Proves the stop gate audit fires end-to-end with REAL CLI agents (Claude, Codex).
 * Each test spawns a real agent on a task node referencing a test SKILL.md with
 * outgoing edges (one hard, one soft). The agent exits without creating progress
 * nodes or spawning children, triggering the audit.
 *
 * Headless tests: audit fires on process exit → detects violations → resumes
 * agent with deficiency prompt via --resume. Assert auditRetryCount > 0 via list_agents.
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

import { expect } from '@playwright/test';
import {
    test,
    hasCliTool,
    mcpCallTool,
    setupMcpAndGraph,
    registerCallerTerminal
} from './stop-gate-lifecycle-setup';

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
        // Allow generous timeout for up to 2 resume cycles with real Claude.
        console.log('=== Waiting for agent to complete audit cycle (up to 2 retries) ===');
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

        // ── Read terminal output for diagnostics ──
        console.log('=== Reading terminal output ===');
        const readResult = await mcpCallTool(mcpUrl, 'read_terminal_output', {
            terminalId: agentTerminalId,
            callerTerminalId
        });
        expect(readResult.success).toBe(true);

        const output: string = (readResult.parsed as { output: string }).output ?? '';
        console.log(`[Claude Headless] Output length: ${output.length} chars`);
        console.log(`[Claude Headless] Output (last 500): ${output.slice(-500)}`);

        // ASSERT: audit mechanism actually fired — check auditRetryCount via list_agents.
        // auditRetryCount > 0 proves the stop gate ran on exit, detected violations,
        // and resumed the agent with a deficiency prompt at least once.
        // This is behavioral evidence vs. fragile string-matching of Claude's output.
        console.log('=== Verifying audit fired via list_agents ===');
        const listResult = await mcpCallTool(mcpUrl, 'list_agents', {});
        expect(listResult.success).toBe(true);
        const finalAgents = (listResult.parsed as {
            agents: Array<{ terminalId: string; status: string; auditRetryCount: number }>
        }).agents;
        const finalAgent = finalAgents.find(a => a.terminalId === agentTerminalId);
        expect(finalAgent).toBeDefined();
        console.log(`[Claude Headless] auditRetryCount: ${finalAgent!.auditRetryCount}`);
        expect(finalAgent!.auditRetryCount).toBeGreaterThan(0);

        console.log('[PASS] Claude headless: audit fired and resumed agent (auditRetryCount > 0)');
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
        // The agent created no progress nodes — expect at least one violation in the deficiency prompt.
        expect(closeResult.success).toBe(false);
        const closeError: string = (closeResult.parsed as { error: string }).error ?? '';
        expect(closeError).toContain('STOP GATE AUDIT FAILED');
        expect(closeError).toMatch(/Hard edge violation|Soft edge violation|No progress nodes created/);

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

        // ASSERT: audit mechanism actually fired — check auditRetryCount via list_agents.
        // auditRetryCount > 0 proves the stop gate ran on exit, detected violations,
        // and resumed the agent with a deficiency prompt at least once.
        // This is behavioral evidence vs. fragile string-matching of Codex's output.
        console.log('=== Verifying audit fired via list_agents ===');
        const listResult = await mcpCallTool(mcpUrl, 'list_agents', {});
        expect(listResult.success).toBe(true);
        const finalAgents = (listResult.parsed as {
            agents: Array<{ terminalId: string; status: string; auditRetryCount: number }>
        }).agents;
        const finalAgent = finalAgents.find(a => a.terminalId === agentTerminalId);
        expect(finalAgent).toBeDefined();
        console.log(`[Codex Headless] auditRetryCount: ${finalAgent!.auditRetryCount}`);
        expect(finalAgent!.auditRetryCount).toBeGreaterThan(0);

        console.log('[PASS] Codex headless: audit fired and resumed agent (auditRetryCount > 0)');
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

        // ASSERT: close should fail because stop gate audit blocked it.
        // The agent did no work, so the audit fires and returns a deficiency prompt.
        // We check success:false + the audit header — not specific violation strings,
        // since violation types depend on the Codex SKILL.md obligations at runtime.
        expect(closeResult.success).toBe(false);
        const closeError: string = (closeResult.parsed as { error: string }).error ?? '';
        expect(closeError).toContain('STOP GATE AUDIT FAILED');

        console.log('[PASS] Codex non-headless: audit blocked self-close with violation details');
    });
});
