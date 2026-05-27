/**
 * Interactive tmux spawn: a giant AGENT_PROMPT (200 KiB) must not overflow
 * the tmux command-protocol buffer. The fix lifts the headless prompt-file
 * primitive onto the interactive renderer-driven path so AGENT_PROMPT
 * spills to disk and an AGENT_PROMPT_FILE pointer is what crosses tmux -e.
 *
 * Black-box: assert on observable side effects only.
 *   - tmux session alive after spawn
 *   - prompt file on disk with the full prompt content
 *   - tmux session env carries AGENT_PROMPT_FILE pointing at the file
 *   - tmux session env's AGENT_PROMPT is empty (the primitive shadows it
 *     with '' to defeat OS env-inheritance)
 *   - the rewritten initialCommand consumes the file via stdin redirect
 *     (claude/gemini) or $(cat) (codex) rather than expanding $AGENT_PROMPT
 *
 * No mocking. Real tmux underneath.
 */

import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, afterEach, describe, expect, it} from 'vitest'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {applyPromptFileToTmuxSpawn} from '@vt/agent-runtime/headless/tmuxPromptFile.ts'
import {spawnTmuxBackedTerminal} from '@vt/agent-runtime/headless/headlessAgentManager.ts'
import {clearTerminalRecords} from '../terminal-registry'
import {hasSession, killSession, resolveTmuxSessionName} from '../tmux/tmux-session-manager'
import {getTmuxBinaryPath, getTmuxCommandArgs} from '../tmux/tmux-server'
import {withVoicetreeVaultPath} from '../tmux/tmuxSpawnPlanning'
import {createTerminalData, type TerminalData, type TerminalId} from '../terminal-registry/types'

const sessions: Set<string> = new Set<string>()
const tempDirs: Set<string> = new Set<string>()

function makeName(): TerminalId {
    return `bf-interactive-promptfile-${randomUUID().slice(0, 8)}` as TerminalId
}

async function makeTempVault(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'bf-interactive-vault-'))
    tempDirs.add(dir)
    return dir
}

async function showSessionEnv(sessionName: string): Promise<Map<string, string>> {
    return new Promise((resolve, reject) => {
        // Must use the VoiceTree private tmux socket (`-S <path>`) — sessions
        // spawned by spawnTmuxBackedTerminal live on that socket, not on the
        // default `/tmp/tmux-$UID/default`. Hitting the default socket would
        // either fail with "no such file" (no server) or "no such session"
        // (server up but our session isn't there).
        const child = spawn(getTmuxBinaryPath(), getTmuxCommandArgs(['show-environment', '-t', sessionName]), {stdio: ['ignore', 'pipe', 'pipe']})
        const out: Buffer[] = []
        const err: Buffer[] = []
        child.stdout.on('data', (c: Buffer) => out.push(c))
        child.stderr.on('data', (c: Buffer) => err.push(c))
        child.on('error', reject)
        child.on('close', (code: number | null) => {
            if (code !== 0) {
                reject(new Error(`tmux show-environment exit ${code}: ${Buffer.concat(err).toString('utf8')}`))
                return
            }
            const parsed: Map<string, string> = new Map()
            for (const line of Buffer.concat(out).toString('utf8').split('\n')) {
                if (!line || line.startsWith('-')) continue
                const eq: number = line.indexOf('=')
                if (eq < 0) continue
                parsed.set(line.slice(0, eq), line.slice(eq + 1))
            }
            resolve(parsed)
        })
    })
}

async function cleanup(): Promise<void> {
    await Promise.all([...sessions].map(async (name: string) => {
        await killSession(name).catch(() => undefined)
        sessions.delete(name)
    }))
    await Promise.all([...tempDirs].map(async (dir: string) => {
        await rm(dir, {recursive: true, force: true})
        tempDirs.delete(dir)
    }))
    clearTerminalRecords()
}

function makeInteractiveTerminalData(terminalId: TerminalId, vaultPath: string): TerminalData {
    return createTerminalData({
        terminalId,
        attachedToNodeId: join(vaultPath, 'context.md') as NodeIdAndFilePath,
        terminalCount: 0,
        title: 'interactive prompt-file overflow regression',
        agentName: terminalId,
        isHeadless: false,
        initialEnvVars: {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_VAULT_PATH: vaultPath,
        },
    })
}

describe('interactive tmux spawn with a giant AGENT_PROMPT (prompt-file primitive on the interactive path)', () => {
    afterEach(cleanup)
    afterAll(cleanup)

    it('does NOT overflow ARG_MAX / tmux command-protocol: spills 200 KiB AGENT_PROMPT to a file, points env at it, and CLI-rewrites the initialCommand', async () => {
        const terminalId: TerminalId = makeName()
        const vaultPath: string = await makeTempVault()
        const giantPrompt: string = 'X'.repeat(200 * 1024)

        // Same shape the interactive renderer path builds: initialEnvVars
        // carries the resolved AGENT_PROMPT (and friends), and initialCommand
        // is the agent CLI command template from settings.agents[].command.
        const initial: Record<string, string> = {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_VAULT_PATH: vaultPath,
            AGENT_PROMPT: giantPrompt,
            // User-settings AGENT_PROMPT_* siblings are still propagated;
            // these are NOT what this test fixes — see fragility report.
            AGENT_PROMPT_CORE: 'core template body',
            AGENT_PROMPT_LIGHTWEIGHT: 'lightweight template body',
        }
        const initialCommand: string = 'claude --dangerously-skip-permissions "$AGENT_PROMPT"'

        // Mirror what `TerminalManager.spawnTmuxBacked` does in
        // packages/systems/agent-runtime/src/application/terminals/terminal-manager.ts:
        const plan = applyPromptFileToTmuxSpawn({
            projectRoot: vaultPath,
            terminalId,
            command: initialCommand,
            env: initial,
        })
        const tmuxEnv: Record<string, string> = withVoicetreeVaultPath(plan.env, vaultPath)

        // Sanity on the plan: prompt file path is set, command is CLI-rewritten,
        // big AGENT_PROMPT is gone from the env vector that tmux -e will receive.
        expect(plan.promptFilePath).toBe(join(vaultPath, '.voicetree', 'terminals', `${terminalId}-prompt.txt`))
        expect(plan.command).toBe(`claude --dangerously-skip-permissions < '${plan.promptFilePath}'`)
        expect(tmuxEnv.AGENT_PROMPT).toBe('')
        expect(tmuxEnv.AGENT_PROMPT_FILE).toBe(plan.promptFilePath)
        const envBytes: number = JSON.stringify(tmuxEnv).length
        expect(envBytes).toBeLessThan(5_000)

        // Real-wire spawn — the assertion this entire fix exists for: tmux
        // does not reject this spawn with "command too long".
        sessions.add(terminalId)
        const terminalData: TerminalData = makeInteractiveTerminalData(terminalId, vaultPath)
        const created: {readonly pid: number} = await spawnTmuxBackedTerminal(
            terminalId,
            terminalData,
            '/bin/bash -l',
            vaultPath,
            tmuxEnv,
            undefined,
            plan.promptFilePath,
        )
        expect(created.pid).toBeGreaterThan(0)
        expect(await hasSession(terminalId)).toBe(true)

        // The prompt is on disk verbatim, mode 0600 (asserted by the unit
        // tests in tmuxPromptFile.test.ts — here we just check content).
        const onDisk: string = await readFile(plan.promptFilePath!, 'utf8')
        expect(onDisk).toBe(giantPrompt)

        // tmux session env carries the pointer, not the body.
        const sessionEnv: Map<string, string> = await showSessionEnv(resolveTmuxSessionName(terminalId))
        expect(sessionEnv.get('AGENT_PROMPT_FILE')).toBe(plan.promptFilePath!)
        // tmux -e AGENT_PROMPT= sets the value to empty string in the
        // session env; show-environment renders this as `AGENT_PROMPT=`.
        expect(sessionEnv.get('AGENT_PROMPT') ?? '').toBe('')
    }, 15000)
})
