/**
 * Black-box CLI tests. Spawns the real `tsx bin/run-bootcamp.ts` as a child
 * process and asserts on stdout / stderr / exit code. No internal mocks —
 * --dry-run is used as the universal "don't burn tokens" escape hatch so we
 * can exercise the full arg-parsing + scenario/driver resolution path
 * without actually invoking the runner.
 *
 * Dry-run emits a JSON plan object, which doubles as the "valid JSON" check.
 */
import {spawn} from 'node:child_process'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const BIN_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'bin',
    'run-bootcamp.ts',
)

type RunOut = {
    readonly stdout: string
    readonly stderr: string
    readonly exitCode: number | null
}

function runCli(args: readonly string[]): Promise<RunOut> {
    return new Promise((resolve, reject) => {
        const child = spawn('npx', ['--no-install', 'tsx', BIN_PATH, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {...process.env},
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d: Buffer) => {
            stdout += d.toString()
        })
        child.stderr.on('data', (d: Buffer) => {
            stderr += d.toString()
        })
        child.on('error', reject)
        child.on('close', (code) => {
            resolve({stdout, stderr, exitCode: code})
        })
    })
}

describe('vt-bootcamp CLI', () => {
    it('--help prints usage and exits 0', async () => {
        const r = await runCli(['--help'])
        expect(r.exitCode).toBe(0)
        expect(r.stdout).toContain('vt-bootcamp')
        expect(r.stdout).toContain('Options:')
        expect(r.stdout).toContain('--model')
    }, 30_000)

    it('-h is an alias for --help', async () => {
        const r = await runCli(['-h'])
        expect(r.exitCode).toBe(0)
        expect(r.stdout).toContain('Options:')
    }, 30_000)

    it('missing scenarioId exits non-zero with a clear error', async () => {
        const r = await runCli([])
        expect(r.exitCode).not.toBe(0)
        expect(r.stderr).toMatch(/scenarioId/i)
    }, 30_000)

    it('unknown scenario exits non-zero', async () => {
        const r = await runCli(['B99', '--model', 'opus', '--dry-run'])
        expect(r.exitCode).not.toBe(0)
        expect(r.stderr).toContain('unknown scenario')
    }, 30_000)

    it('missing --model exits non-zero with a clear error', async () => {
        const r = await runCli(['B7', '--dry-run'])
        expect(r.exitCode).not.toBe(0)
        expect(r.stderr).toContain('--model')
    }, 30_000)

    it('unknown model exits non-zero', async () => {
        const r = await runCli(['B7', '--model', 'gpt-4', '--dry-run'])
        expect(r.exitCode).not.toBe(0)
        expect(r.stderr).toContain('unknown model')
    }, 30_000)

    it('invalid --effort exits non-zero', async () => {
        const r = await runCli(['B7', '--model', 'opus', '--effort', 'ultra', '--dry-run'])
        expect(r.exitCode).not.toBe(0)
        expect(r.stderr).toMatch(/effort/)
    }, 30_000)

    it('invalid --reps exits non-zero', async () => {
        const r = await runCli(['B7', '--model', 'opus', '--reps', '0', '--dry-run'])
        expect(r.exitCode).not.toBe(0)
        expect(r.stderr).toMatch(/reps/)
    }, 30_000)

    it('--dry-run exits 0 and emits a valid JSON plan', async () => {
        const r = await runCli(['B7', '--model', 'opus', '--dry-run'])
        expect(r.exitCode).toBe(0)
        const plan = JSON.parse(r.stdout) as Record<string, unknown>
        expect(plan).toMatchObject({
            scenarioId: 'B7',
            driver: 'claude',
            model: 'opus',
            effort: 'medium',
            mode: 'headless',
            reps: 1,
        })
    }, 30_000)

    it('--dry-run accepts case-insensitive scenarioId', async () => {
        const r = await runCli(['b7', '--model', 'opus', '--dry-run'])
        expect(r.exitCode).toBe(0)
        const plan = JSON.parse(r.stdout) as Record<string, unknown>
        expect(plan.scenarioId).toBe('B7')
    }, 30_000)

    it('--dry-run picks codex driver for codex models', async () => {
        const r = await runCli(['B7', '--model', 'codex-1', '--dry-run'])
        expect(r.exitCode).toBe(0)
        const plan = JSON.parse(r.stdout) as Record<string, unknown>
        expect(plan.driver).toBe('codex')
    }, 30_000)

    it('--dry-run carries through --effort, --mode, --reps overrides', async () => {
        const r = await runCli([
            'B7', '--model', 'opus',
            '--effort', 'high',
            '--mode', 'headful',
            '--reps', '3',
            '--headful-parent', '/tmp/some-node.md',
            '--workspace-root', '/tmp/b7-run',
            '--headful-caller-terminal', 'term-abc',
            '--dry-run',
        ])
        expect(r.exitCode).toBe(0)
        const plan = JSON.parse(r.stdout) as Record<string, unknown>
        expect(plan).toMatchObject({
            effort: 'high',
            mode: 'headful',
            reps: 3,
            headfulParentNodeId: '/tmp/some-node.md',
            workspaceRoot: '/tmp/b7-run',
            headfulCallerTerminalId: 'term-abc',
        })
    }, 30_000)

    it('--mode headful without --headful-parent exits non-zero', async () => {
        const r = await runCli([
            'B7', '--model', 'opus',
            '--mode', 'headful',
            '--workspace-root', '/tmp/b7-run',
            '--dry-run',
        ])
        expect(r.exitCode).not.toBe(0)
        expect(r.stderr).toMatch(/headful-parent/)
    }, 30_000)

    it('--mode headful without --workspace-root exits non-zero', async () => {
        const r = await runCli([
            'B7', '--model', 'opus',
            '--mode', 'headful',
            '--headful-parent', '/tmp/some-node.md',
            '--dry-run',
        ])
        expect(r.exitCode).not.toBe(0)
        expect(r.stderr).toMatch(/workspace-root/)
    }, 30_000)

    it('--mode headful without caller terminal id (flag or env) exits non-zero', async () => {
        // Strip $VOICETREE_TERMINAL_ID so the env-var fallback can't satisfy the check.
        const env = {...process.env}
        delete env.VOICETREE_TERMINAL_ID
        const child = spawn(
            'npx',
            ['--no-install', 'tsx', BIN_PATH,
                'B7', '--model', 'opus',
                '--mode', 'headful',
                '--headful-parent', '/tmp/some-node.md',
                '--workspace-root', '/tmp/b7-run',
                '--dry-run',
            ],
            {stdio: ['ignore', 'pipe', 'pipe'], env},
        )
        let stderr = ''
        child.stderr.on('data', (d: Buffer) => {
            stderr += d.toString()
        })
        const exitCode = await new Promise<number | null>((resolve) => {
            child.on('close', (code) => resolve(code))
        })
        expect(exitCode).not.toBe(0)
        expect(stderr).toMatch(/headful-caller-terminal/)
    }, 30_000)

    it('--mode headful accepts $VOICETREE_TERMINAL_ID in lieu of the flag', async () => {
        const env = {...process.env, VOICETREE_TERMINAL_ID: 'term-from-env'}
        const child = spawn(
            'npx',
            ['--no-install', 'tsx', BIN_PATH,
                'B7', '--model', 'opus',
                '--mode', 'headful',
                '--headful-parent', '/tmp/some-node.md',
                '--workspace-root', '/tmp/b7-run',
                '--dry-run',
            ],
            {stdio: ['ignore', 'pipe', 'pipe'], env},
        )
        let stdout = ''
        child.stdout.on('data', (d: Buffer) => {
            stdout += d.toString()
        })
        const exitCode = await new Promise<number | null>((resolve) => {
            child.on('close', (code) => resolve(code))
        })
        expect(exitCode).toBe(0)
        const plan = JSON.parse(stdout) as Record<string, unknown>
        expect(plan.mode).toBe('headful')
    }, 30_000)
})
