import {spawn, type ChildProcess} from 'node:child_process'
import {access, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR: string = resolve(TEST_FILE_DIR, '../../../..')
const REPO_ROOT: string = resolve(PACKAGE_DIR, '../../..')
const CLI_ENTRYPOINT: string = join(PACKAGE_DIR, 'src/voicetree-cli.ts')
// Resolve tsx through Node's own module lookup. Worktrees keep most deps in
// the main repo's node_modules and do not always materialise a usable
// tsx/dist/loader.mjs under the worktree root.
const TSX_LOADER: string = createRequire(import.meta.url).resolve('tsx')
const CLI_TSCONFIG: string = join(PACKAGE_DIR, 'tsconfig.json')
const CLI_EXIT_TIMEOUT_MS: number = 20_000
const HEADLESS_START_TIMEOUT_MS: number = 15_000

type SpawnResult = {
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
}

const tempDirs: string[] = []
const servers: Array<{close(): Promise<void>}> = []

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()))

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
        // Suppress Node ≥22 ExperimentalWarning when @vt/graph-db-server loads
        // node:sqlite (still flagged experimental). The warning is benign and
        // unrelated to CLI module resolution; without this, the strict
        // `expect(stderr).toBe('')` check below fails on every CLI invocation.
        NODE_OPTIONS: ['--disable-warning=ExperimentalWarning', process.env.NODE_OPTIONS]
            .filter((segment: string | undefined): segment is string => typeof segment === 'string' && segment.length > 0)
            .join(' '),
        TSX_TSCONFIG_PATH: CLI_TSCONFIG,
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

function spawnCli(args: string[], cwd: string, envOverrides?: Record<string, string>): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
        const child: ChildProcess = spawn(process.execPath, ['--import', TSX_LOADER, CLI_ENTRYPOINT, ...args], {
            cwd,
            env: buildChildEnv(envOverrides),
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

async function startHeadless(vault: string): Promise<{readonly url: string; readonly vaultPath: string; close(): Promise<void>}> {
    const child: ChildProcess = spawn(
        process.execPath,
        [
            '--import',
            TSX_LOADER,
            join(REPO_ROOT, 'packages/libraries/graph-tools/bin/vt-headless.ts'),
            'serve',
            '--vault',
            vault,
            '--port',
            '0',
        ],
        {
            cwd: REPO_ROOT,
            env: buildChildEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    )

    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string): void => {
        stdout += chunk
    })
    child.stderr?.on('data', (chunk: string): void => {
        stderr += chunk
    })

    const url: string = await new Promise<string>((resolvePromise, rejectPromise) => {
        const timeout: NodeJS.Timeout = setTimeout(() => {
            child.kill('SIGINT')
            rejectPromise(new Error(`vt-headless did not announce a URL. stdout=${stdout} stderr=${stderr}`))
        }, HEADLESS_START_TIMEOUT_MS)

        child.stdout?.on('data', (): void => {
            const match: RegExpMatchArray | null = stdout.match(/Listening on (http:\/\/\S+)/)
            if (!match) return
            clearTimeout(timeout)
            resolvePromise(match[1].trim())
        })
        child.once('exit', (code: number | null): void => {
            clearTimeout(timeout)
            rejectPromise(new Error(`vt-headless exited early with ${code}. stdout=${stdout} stderr=${stderr}`))
        })
    })

    return {
        url,
        vaultPath: vault,
        close: async (): Promise<void> => {
            if (child.exitCode !== null) return
            child.kill('SIGINT')
            await new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise()))
        },
    }
}

function daemonEnv(server: {url: string; vaultPath: string}): Record<string, string> {
    return {VOICETREE_DAEMON_URL: server.url, VOICETREE_VAULT_PATH: server.vaultPath}
}

describe('graph CLI module resolution', () => {
    it('prints top-level help without eagerly loading serve-only packages', async () => {
        const tempDir: string = await mkdtemp(join(tmpdir(), 'vt-cli-help-'))
        tempDirs.push(tempDir)

        const result: SpawnResult = await spawnCli(['--help'], tempDir)

        expect(result.code, result.stderr).toBe(0)
        expect(result.signal).toBeNull()
        expect(result.stderr).toBe('')
        expect(result.stdout).toContain('Usage: vt')
        expect(result.stdout).toContain('serve')
    }, 30000)

    it('routes graph live through the vt-graph live implementation with vt-shaped help', async () => {
        const tempDir: string = await mkdtemp(join(tmpdir(), 'vt-cli-graph-live-'))
        tempDirs.push(tempDir)

        const result: SpawnResult = await spawnCli(['graph', 'live', 'add-node', '--help'], tempDir)

        expect(result.code, result.stderr).toBe(0)
        expect(result.signal).toBeNull()
        expect(result.stderr).toBe('')
        expect(result.stdout).toContain('Usage: vt graph live add-node --file <path>')
        expect(result.stdout).not.toContain('vt-graph live')
    }, 30000)

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
            kind: 'graph_create_batch_result',
            nodes: [
                {
                    path: './test-node.md',
                    status: 'skipped',
                    skipReason: 'no_vault_detected',
                },
            ],
            summary: {ok: 0, rejected: 0, skipped: 1, warning: 0},
        })
    }, 30000)

    it('routes graph structure into argument validation instead of @/shell resolution failure', async () => {
        const tempDir: string = await mkdtemp(join(tmpdir(), 'vt-cli-graph-structure-'))
        tempDirs.push(tempDir)

        const result: SpawnResult = await spawnCli(['graph', 'structure', '--bogus'], tempDir)

        expect(result.code, result.stderr).toBe(1)
        expect(result.signal).toBeNull()
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain('Unknown argument: --bogus')
        expect(result.stderr).not.toContain("Cannot find package '@/shell'")
    }, 30000)

    it('routes graph view into handler-level validation instead of @/shell resolution failure', async () => {
        const tempDir: string = await mkdtemp(join(tmpdir(), 'vt-cli-graph-view-'))
        tempDirs.push(tempDir)

        const result: SpawnResult = await spawnCli(['graph', 'view', '--bogus'], tempDir)

        expect(result.code, result.stderr).toBe(1)
        expect(result.signal).toBeNull()
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain('Unknown argument: --bogus')
        expect(result.stderr).not.toContain("Cannot find package '@/shell'")
    }, 30000)

    it('persists graph live CRUD through cwd-relative shell CLI paths', async () => {
        const tempDir: string = await mkdtemp(join(tmpdir(), 'vt-cli-graph-live-crud-'))
        tempDirs.push(tempDir)
        const canonicalTempDir: string = await realpath(tempDir)
        await mkdir(join(tempDir, '.voicetree'), {recursive: true})
        await writeFile(join(tempDir, 'source.md'), '# Source\n\nlegacy [[target.md]]\n', 'utf8')
        await writeFile(join(tempDir, 'target.md'), '# Target\n', 'utf8')

        const server = await startHeadless(canonicalTempDir)
        servers.push(server)
        const relativeFile = `rel-${process.pid}-${Date.now()}.md`

        const addNode: SpawnResult = await spawnCli(
            [
                'graph',
                'live',
                'add-node',
                '--file',
                relativeFile,
                '--label',
                '# Relative\n',
                '--x',
                '4',
                '--y',
                '5',
            ],
            tempDir,
            daemonEnv(server),
        )
        expect(addNode.code, addNode.stderr).toBe(0)
        expect(await readFile(join(tempDir, relativeFile), 'utf8')).toBe('# Relative\n')
        await expect(access(join(REPO_ROOT, relativeFile))).rejects.toThrow()

        const state: SpawnResult = await spawnCli(
            ['graph', 'live', 'state', 'dump', '--no-pretty'],
            tempDir,
            daemonEnv(server),
        )
        expect(state.code, state.stderr).toBe(0)
        expect(Object.keys(JSON.parse(state.stdout).graph.nodes)).toContain(join(canonicalTempDir, relativeFile))

        const moveNode: SpawnResult = await spawnCli(
            [
                'graph',
                'live',
                'mv-node',
                '--file',
                relativeFile,
                '--x',
                '6',
                '--y',
                '7',
            ],
            tempDir,
            daemonEnv(server),
        )
        expect(moveNode.code, moveNode.stderr).toBe(0)
        const positions = JSON.parse(await readFile(join(tempDir, '.voicetree', 'positions.json'), 'utf8'))
        expect(positions[join(canonicalTempDir, relativeFile)]).toEqual({x: 6, y: 7})

        const removeEdge: SpawnResult = await spawnCli(
            [
                'graph',
                'live',
                'rm-edge',
                '--src-file',
                'source.md',
                '--tgt-file',
                'target.md',
            ],
            tempDir,
            daemonEnv(server),
        )
        expect(removeEdge.code, removeEdge.stderr).toBe(0)
        expect(await readFile(join(tempDir, 'source.md'), 'utf8')).not.toContain('[[target.md]]')

        const missingSource = `missing-${process.pid}-${Date.now()}.md`
        const addMissingEdge: SpawnResult = await spawnCli(
            [
                'graph',
                'live',
                'add-edge',
                '--src-file',
                missingSource,
                '--tgt-file',
                'target.md',
            ],
            tempDir,
            daemonEnv(server),
        )
        expect(addMissingEdge.code, addMissingEdge.stderr).toBe(0)
        await expect(access(join(tempDir, missingSource))).rejects.toThrow()

        const removeNode: SpawnResult = await spawnCli(
            ['graph', 'live', 'rm-node', '--file', relativeFile],
            tempDir,
            daemonEnv(server),
        )
        expect(removeNode.code, removeNode.stderr).toBe(0)
        await expect(access(join(tempDir, relativeFile))).rejects.toThrow()
        const positionsAfterRemove = JSON.parse(await readFile(join(tempDir, '.voicetree', 'positions.json'), 'utf8'))
        expect(Object.hasOwn(positionsAfterRemove, join(canonicalTempDir, relativeFile))).toBe(false)
    }, 60000)

    it('persists positions when the loaded vault root and CLI cwd use symlink variants', async () => {
        const tempDir: string = await mkdtemp(join(tmpdir(), 'vt-cli-graph-live-symlink-root-'))
        tempDirs.push(tempDir)
        const canonicalTempDir: string = await realpath(tempDir)
        const relativeFile = `rel-${process.pid}-${Date.now()}.md`
        await writeFile(join(tempDir, 'source.md'), '# Source\n\nlegacy [[target.md]]\n', 'utf8')
        await writeFile(join(tempDir, 'target.md'), '# Target\n', 'utf8')

        const server = await startHeadless(tempDir)
        servers.push(server)

        const addNode: SpawnResult = await spawnCli(
            [
                'graph',
                'live',
                'add-node',
                '--file',
                relativeFile,
                '--label',
                '# Relative\n',
                '--x',
                '1',
                '--y',
                '2',
            ],
            tempDir,
            daemonEnv(server),
        )
        expect(addNode.code, addNode.stderr).toBe(0)

        const moveNode: SpawnResult = await spawnCli(
            [
                'graph',
                'live',
                'mv-node',
                '--file',
                relativeFile,
                '--x',
                '3',
                '--y',
                '4',
            ],
            tempDir,
            daemonEnv(server),
        )
        expect(moveNode.code, moveNode.stderr).toBe(0)

        const positions = JSON.parse(await readFile(join(tempDir, '.voicetree', 'positions.json'), 'utf8'))
        expect(positions[join(canonicalTempDir, relativeFile)]).toEqual({x: 3, y: 4})

        const removeEdge: SpawnResult = await spawnCli(
            [
                'graph',
                'live',
                'rm-edge',
                '--src-file',
                'source.md',
                '--tgt-file',
                'target.md',
            ],
            tempDir,
            daemonEnv(server),
        )
        expect(removeEdge.code, removeEdge.stderr).toBe(0)
        expect(await readFile(join(tempDir, 'source.md'), 'utf8')).not.toContain('[[target.md]]')
    }, 60000)

    it('rm-edge preserves same-basename wikilinks that point at other live targets', async () => {
        const tempDir: string = await mkdtemp(join(tmpdir(), 'vt-cli-graph-live-rm-edge-'))
        tempDirs.push(tempDir)
        const canonicalTempDir: string = await realpath(tempDir)
        await mkdir(join(tempDir, 'a'), {recursive: true})
        await mkdir(join(tempDir, 'b'), {recursive: true})
        await writeFile(
            join(tempDir, 'source.md'),
            '# Source\n\nkeep A [[a/target.md]]\nkeep B [[b/target.md]]\ncombo [[a/target.md]] plus [[b/target.md]]\nplain text\n',
            'utf8',
        )
        await writeFile(join(tempDir, 'a', 'target.md'), '# A\n', 'utf8')
        await writeFile(join(tempDir, 'b', 'target.md'), '# B\n', 'utf8')

        const server = await startHeadless(canonicalTempDir)
        servers.push(server)

        const removeEdge: SpawnResult = await spawnCli(
            [
                'graph',
                'live',
                'rm-edge',
                '--src-file',
                'source.md',
                '--tgt-file',
                'a/target.md',
            ],
            tempDir,
            daemonEnv(server),
        )
        expect(removeEdge.code, removeEdge.stderr).toBe(0)

        const sourceAfterRemove = await readFile(join(tempDir, 'source.md'), 'utf8')
        expect(sourceAfterRemove).not.toContain('keep A [[a/target.md]]')
        expect(sourceAfterRemove).toContain('keep B [[b/target.md]]')
        expect(sourceAfterRemove).toContain('combo [[a/target.md]] plus [[b/target.md]]')
        expect(sourceAfterRemove).toContain('plain text')

        const state: SpawnResult = await spawnCli(
            ['graph', 'live', 'state', 'dump', '--no-pretty'],
            tempDir,
            daemonEnv(server),
        )
        expect(state.code, state.stderr).toBe(0)
        const sourceNode = JSON.parse(state.stdout).graph.nodes[join(canonicalTempDir, 'source.md')]
        expect(sourceNode.outgoingEdges).toEqual(
            expect.arrayContaining([
                {targetId: join(canonicalTempDir, 'b', 'target.md'), label: 'keep B'},
            ]),
        )
        expect(sourceNode.outgoingEdges).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({targetId: join(canonicalTempDir, 'a', 'target.md'), label: 'keep A'}),
            ]),
        )
    }, 60000)
})
