import {spawn, type ChildProcess} from 'node:child_process'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR: string = resolve(TEST_FILE_DIR, '..')
const REPO_ROOT: string = resolve(PACKAGE_DIR, '../../..')
const VT_BIN: string = join(PACKAGE_DIR, 'bin', 'vt')
const CLI_EXIT_TIMEOUT_MS: number = 20_000
const SCENARIO_TIMEOUT_MS: number = 30_000

type SpawnResult = {
    readonly code: number | null
    readonly stdout: string
    readonly stderr: string
}

type FakeDaemon = {
    readonly url: string
    readonly close: () => Promise<void>
}

function buildVtEnv(overrides: Record<string, string | undefined>): Record<string, string> {
    const merged: Record<string, string | undefined> = {
        ...process.env,
        VT_FORCE_SOURCE: '1',
        ...overrides,
    }
    delete merged.VT_SESSION
    delete merged.VOICETREE_TERMINAL_ID

    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
        if (value !== undefined) env[key] = value
    }
    return env
}

function runVt(args: string[], env: Record<string, string | undefined>): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
        const child: ChildProcess = spawn(VT_BIN, args, {
            cwd: REPO_ROOT,
            env: buildVtEnv(env),
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

        const timer: NodeJS.Timeout = setTimeout((): void => {
            child.kill('SIGKILL')
            rejectPromise(new Error(`vt ${args.join(' ')} timed out after ${CLI_EXIT_TIMEOUT_MS}ms`))
        }, CLI_EXIT_TIMEOUT_MS)

        child.on('error', (err: Error): void => {
            clearTimeout(timer)
            rejectPromise(err)
        })
        child.on('close', (code: number | null): void => {
            clearTimeout(timer)
            resolvePromise({
                code,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
            })
        })
    })
}

function parsePayload(result: SpawnResult): {availableAgents: string[]} {
    try {
        return JSON.parse(result.stdout) as {availableAgents: string[]}
    } catch (err) {
        throw new Error(
            `Failed to parse vt stdout as JSON (exit ${result.code}):\n${result.stdout}\n---stderr---\n${result.stderr}\n--- (${(err as Error).message})`,
        )
    }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

async function startFakeDaemon(
    projectPath: string,
    token: string,
    availableAgents: readonly string[],
): Promise<FakeDaemon> {
    await mkdir(join(projectPath, '.voicetree'), {recursive: true})

    const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        if (request.method !== 'POST' || request.url !== '/rpc') {
            response.writeHead(404)
            response.end('not found')
            return
        }
        if (request.headers.authorization !== `Bearer ${token}`) {
            response.writeHead(401)
            response.end('unauthorized')
            return
        }

        const body: {id?: number | string | null; method?: string} = await readBody(request) as {
            id?: number | string | null
            method?: string
        }
        if (body.method !== 'list_agents') {
            response.writeHead(200, {'Content-Type': 'application/json'})
            response.end(JSON.stringify({
                jsonrpc: '2.0',
                id: body.id ?? null,
                error: {code: -32601, message: `unexpected method ${body.method ?? '<missing>'}`},
            }))
            return
        }

        response.writeHead(200, {'Content-Type': 'application/json'})
        response.end(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id ?? null,
            result: {success: true, agents: [], availableAgents},
        }))
    })

    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise)
        server.listen(0, '127.0.0.1', resolvePromise)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
        throw new Error('fake daemon did not bind to a TCP port')
    }

    await writeFile(join(projectPath, '.voicetree', 'rpc.port'), `${address.port}\n`, 'utf8')
    await writeFile(join(projectPath, '.voicetree', 'auth-token'), `${token}\n`, 'utf8')

    return {
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolvePromise, rejectPromise) => {
            server.close((err?: Error): void => {
                if (err) rejectPromise(err)
                else resolvePromise()
            })
        }),
    }
}

describe.skipIf(process.env.CI_SANDBOX === '1')(
    'vt agent list --project',
    () => {
        let root: string
        let envProject: string
        let requestedProject: string
        let envHome: string
        const daemons: FakeDaemon[] = []

        beforeEach(async () => {
            root = await mkdtemp(join(tmpdir(), 'vt-agent-project-'))
            envProject = join(root, 'env-project')
            requestedProject = join(root, 'requested-project')
            envHome = join(root, 'env-home')
            await mkdir(join(envProject, '.voicetree'), {recursive: true})
            await mkdir(join(requestedProject, '.voicetree'), {recursive: true})
            await mkdir(envHome, {recursive: true})
        })

        afterEach(async () => {
            for (const daemon of daemons) {
                await daemon.close().catch(() => undefined)
            }
            daemons.length = 0
            await rm(root, {recursive: true, force: true}).catch(() => undefined)
        })

        it(
            'uses the requested project instead of inherited daemon env for spaced and equals forms',
            async () => {
                const envDaemon: FakeDaemon = await startFakeDaemon(
                    envProject,
                    'env-token',
                    ['Env Project Agent'],
                )
                const requestedDaemon: FakeDaemon = await startFakeDaemon(
                    requestedProject,
                    'requested-token',
                    ['Requested Project Agent'],
                )
                daemons.push(envDaemon, requestedDaemon)

                for (const projectArgs of [
                    ['--project', requestedProject],
                    [`--project=${requestedProject}`],
                ]) {
                    const result: SpawnResult = await runVt(
                        ['agent', 'list', ...projectArgs],
                        {
                            VOICETREE_DAEMON_URL: envDaemon.url,
                            VOICETREE_PROJECT_PATH: envProject,
                            VOICETREE_HOME_PATH: envHome,
                        },
                    )

                    expect(result.code, result.stderr).toBe(0)
                    const payload: {availableAgents: string[]} = parsePayload(result)
                    expect(payload.availableAgents).toEqual(['Requested Project Agent'])
                }
            },
            SCENARIO_TIMEOUT_MS,
        )
    },
)
