/**
 * Single vt-fake-agent spawn for the e2e-storm MVP.
 *
 * The full e2e-storm spec uses agent-runtime's `spawnTmuxBacked` to deliver
 * the prompt over a PTY through the Alt+Enter ceremony decoder. That path
 * pulls in graph-model singletons which aren't initialized in our shell
 * process (the parent agent observed this failure mode). The MVP instead
 * spawns vt-fake-agent as a plain child process via tsx; the agent reads its
 * script from the `AGENT_PROMPT` env var (see tools/vt-fake-agent/src/index.ts
 * `resolveAgentPrompt`), so no PTY ceremony is needed.
 *
 * This is closer to how packages/measures/perf/agent-storm.ts works — except
 * we skip agent-runtime entirely. Real MCP HTTP, real daemon, real SQLite,
 * real .md writes; only the spawn-shell is shorter.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

export interface FakeAgentInputs {
    readonly repoRoot: string
    readonly vaultDir: string
    readonly mcpPort: number
    readonly terminalId: string
    readonly script: object
    readonly timeoutMs: number
}

export interface FakeAgentResult {
    readonly exitCode: number | null
    readonly signal: NodeJS.Signals | null
    readonly wallMs: number
    readonly timedOut: boolean
    readonly stdout: string
    readonly stderr: string
}

function buildAgentPrompt(script: object): string {
    return `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`
}

function resolveFakeAgentEntrypoint(repoRoot: string): string {
    const entry = path.join(repoRoot, 'tools', 'vt-fake-agent', 'src', 'index.ts')
    if (!existsSync(entry)) throw new Error(`vt-fake-agent entrypoint not found at ${entry}`)
    return entry
}

function resolveTsxImportPath(): string {
    return require.resolve('tsx')
}

export function buildSingleCreateNodeScript(title: string): object {
    return {
        actions: [
            {
                type: 'create_node',
                title,
                summary: `MVP node ${title}`,
                content: `Body of ${title} written by the e2e-storm-mvp harness.`,
            },
            { type: 'exit', code: 0 },
        ],
    }
}

/** Mark `__dirname` as referenced so noUnusedLocals stays happy under tsx. */
export const __sourceDir = __dirname

export async function runFakeAgent(inputs: FakeAgentInputs): Promise<FakeAgentResult> {
    const entry = resolveFakeAgentEntrypoint(inputs.repoRoot)
    const tsxImportPath = resolveTsxImportPath()

    const wallStart = Date.now()
    const child: ChildProcess = spawn(
        process.execPath,
        ['--import', tsxImportPath, entry],
        {
            cwd: path.dirname(entry),
            env: {
                ...process.env,
                VOICETREE_TERMINAL_ID: inputs.terminalId,
                VOICETREE_MCP_PORT: String(inputs.mcpPort),
                VOICETREE_VAULT_PATH: inputs.vaultDir,
                TASK_NODE_PATH: path.join(inputs.vaultDir, `${inputs.terminalId}-task.md`),
                AGENT_PROMPT: buildAgentPrompt(inputs.script),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        },
    )

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (b: Buffer) => { stdout += b.toString('utf8') })
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf8') })

    // vt-fake-agent does not exit on its own after `exit` action; it stays in
    // REPL mode until stdin EOF. Close stdin immediately so the `process.stdin
    // .on('end', ...)` handler fires once the script's `exit` action runs.
    child.stdin?.end()

    let timedOut = false
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        const timer = setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            // Hard kill after grace period if SIGTERM is ignored.
            setTimeout(() => { if (!child.killed) child.kill('SIGKILL') }, 2000)
        }, inputs.timeoutMs)

        child.on('exit', (code, signal) => {
            clearTimeout(timer)
            resolve({ code, signal })
        })
    })

    return {
        exitCode: result.code,
        signal: result.signal,
        wallMs: Date.now() - wallStart,
        timedOut,
        stdout,
        stderr,
    }
}
