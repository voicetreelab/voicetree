import {spawn, type ChildProcess} from 'node:child_process'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_FILE_DIR, '../../../../../../../')
const CLI_ENTRYPOINT: string = join(REPO_ROOT, 'webapp/src/shell/edge/main/cli/voicetree-cli.ts')
const TSX_LOADER: string = join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs')
const CLI_EXIT_TIMEOUT_MS: number = 20_000

type SpawnResult = {
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
}

const tempDirs: string[] = []

afterEach(async () => {
    while (tempDirs.length > 0) {
        const directory: string | undefined = tempDirs.pop()
        if (directory) {
            await rm(directory, {recursive: true, force: true})
        }
    }
})

function buildChildEnv(
    overrides: Record<string, string | undefined> = {},
): Record<string, string> {
    const merged: Record<string, string | undefined> = {
        ...process.env,
        ...overrides,
    }

    delete merged.VT_SESSION
    delete merged.VOICETREE_TERMINAL_ID

    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
        if (value !== undefined) {
            result[key] = value
        }
    }

    return result
}

function spawnCli(args: string[], cwd: string): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
        const child: ChildProcess = spawn(process.execPath, ['--import', TSX_LOADER, CLI_ENTRYPOINT, ...args], {
            cwd,
            env: buildChildEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        child.stdout?.on('data', (chunk: Buffer): void => {
            stdoutChunks.push(chunk)
        })
        child.stderr?.on('data', (chunk: Buffer): void => {
            stderrChunks.push(chunk)
        })

        const killTimer: NodeJS.Timeout = setTimeout(() => {
            child.kill('SIGKILL')
            rejectPromise(new Error(`CLI did not exit within ${CLI_EXIT_TIMEOUT_MS}ms: vt ${args.join(' ')}`))
        }, CLI_EXIT_TIMEOUT_MS)

        child.on('error', (err: Error) => {
            clearTimeout(killTimer)
            rejectPromise(err)
        })
        child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
            clearTimeout(killTimer)
            resolvePromise({
                code,
                signal,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
            })
        })
    })
}

describe('graph CLI module resolution', () => {
    it('loads graph create through the real CLI entrypoint and validates filesystem mode', async () => {
        const tempDir: string = await mkdtemp(join(tmpdir(), 'vt-cli-graph-create-'))
        tempDirs.push(tempDir)
        await writeFile(join(tempDir, 'test-node.md'), '# Test Node\n\nChild summary\n', 'utf8')

        const result: SpawnResult = await spawnCli(
            ['graph', 'create', './test-node.md', '--validate-only'],
            tempDir,
        )

        expect(result.code, result.stderr).toBe(0)
        expect(result.signal).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({
            success: true,
            mode: 'filesystem',
            validateOnly: true,
            nodes: [
                {
                    path: 'test-node.md',
                    status: 'ok',
                },
            ],
        })
    })

    it('routes graph structure into argument validation instead of @/shell resolution failure', async () => {
        const tempDir: string = await mkdtemp(join(tmpdir(), 'vt-cli-graph-structure-'))
        tempDirs.push(tempDir)

        const result: SpawnResult = await spawnCli(['graph', 'structure'], tempDir)

        expect(result.code, result.stderr).toBe(1)
        expect(result.signal).toBeNull()
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain('Usage: vt graph structure <folder-path> [--with-summaries|--no-summaries]')
        expect(result.stderr).not.toContain("Cannot find package '@/shell'")
    })

    it('routes graph view into handler-level validation instead of @/shell resolution failure', async () => {
        const tempDir: string = await mkdtemp(join(tmpdir(), 'vt-cli-graph-view-'))
        tempDirs.push(tempDir)

        const result: SpawnResult = await spawnCli(['graph', 'view', '--bogus'], tempDir)

        expect(result.code, result.stderr).toBe(1)
        expect(result.signal).toBeNull()
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain('Unknown argument: --bogus')
        expect(result.stderr).not.toContain("Cannot find package '@/shell'")
    })
})
