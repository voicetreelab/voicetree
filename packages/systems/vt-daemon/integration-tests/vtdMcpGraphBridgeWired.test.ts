/**
 * Regression test for BF-376 + the follow-up `MCP graph bridge not configured`
 * blocker: every graph-touching MCP tool was throwing because `bin/vtd.ts`
 * acquired the vt-graphd handle from `ensureGraphDaemonForProject` but never
 * passed it to `configureMcpServer`. The class of regression survived
 * because every prior integration test called `configureMcpServer` directly
 * in its setup — masking the missing wire-up in the binary boot path.
 *
 * This test fixes that hole by being black-box end-to-end:
 *
 *   - spawns the REAL `bin/vtd.ts` against a temp project (NO in-test
 *     `configureMcpServer` call, no in-process imports of daemon internals);
 *   - lets vtd discover the REAL `vt-graphd` sibling via its default
 *     resolution (no `VT_GRAPHD_BIN` override) — same boot path real users
 *     hit;
 *   - posts a JSON-RPC request for `list_agents` (which calls `getMcpGraph`
 *     and is exactly the tool Bob observed failing with `vt agent list`);
 *   - asserts the observable boundary: the response is a JSON-RPC success
 *     envelope, not an error envelope containing the
 *     "MCP graph bridge not configured" string.
 *
 * Per CLAUDE.md: no `toHaveBeenCalledWith`, no internal-dep mocking, no
 * peeking at the in-process module state. The assertion is on the bytes
 * coming back over the HTTP wire — the same surface a real CLI agent sees.
 */

import {spawn, spawnSync, type ChildProcess} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR: string = resolve(TEST_FILE_DIR, '..')
const REPO_ROOT: string = resolve(PACKAGE_DIR, '../../..')
const VTD_ENTRYPOINT: string = join(PACKAGE_DIR, 'bin/vtd.ts')

const TSX_REQUIRE = createRequire(import.meta.url)
const TSX_PACKAGE_DIR: string = dirname(TSX_REQUIRE.resolve('tsx/package.json'))
const TSX_CLI_PATH: string = join(TSX_PACKAGE_DIR, 'dist', 'cli.mjs')
const NODE_BIN: string = process.execPath

const STARTUP_TIMEOUT_MS: number = 30_000
const SHUTDOWN_TIMEOUT_MS: number = 10_000
const RPC_TIMEOUT_MS: number = 10_000

const READINESS_REGEX: RegExp = /^vtd: listening on (https?:\/\/[^,]+), project=(\S+), gdb=(\d+)$/m

type LaunchOutcome = {
    readonly child: ChildProcess
    readonly httpUrl: string
    readonly gdbPort: number
}

async function makeTempProject(prefix: string): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), prefix))
    await mkdir(join(dir, '.voicetree'), {recursive: true})
    return dir
}

function killForgiving(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
    try {
        process.kill(pid, signal)
    } catch {
        // already gone
    }
}

function listGraphdPidsForProject(project: string): readonly number[] {
    if (process.platform !== 'darwin' && process.platform !== 'linux') return []
    const canonical: string = resolve(project)
    const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], {
        encoding: 'utf8',
        timeout: 5000,
    })
    if (result.status !== 0 || !result.stdout) return []
    const pids: number[] = []
    for (const line of result.stdout.split('\n')) {
        const match = /vt-graphd[^\s]*\s.*--project-root\s+(\S+)/.exec(line)
        if (!match) continue
        if (resolve(match[1]) !== canonical) continue
        const pidStr: string = line.trim().split(/\s+/, 1)[0]
        const pid: number = Number(pidStr)
        if (Number.isInteger(pid) && pid > 0) pids.push(pid)
    }
    return pids
}

async function spawnRealVtd(project: string): Promise<LaunchOutcome> {
    // No VT_GRAPHD_BIN override — vtd uses the same sibling resolution real
    // users hit, which spawns the real vt-graphd from
    // @vt/graph-db-server/dist. The regression we are catching only
    // reproduces when the bridge is wired against the real graphd's RPC
    // routes.
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) env[k] = v
    }
    const child: ChildProcess = spawn(
        NODE_BIN,
        [TSX_CLI_PATH, VTD_ENTRYPOINT, '--project', project, '--port', '0'],
        {cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: false},
    )
    let stdout: string = ''
    let stderr: string = ''
    child.stdout!.on('data', (chunk: Buffer): void => {
        stdout += chunk.toString('utf8')
    })
    child.stderr!.on('data', (chunk: Buffer): void => {
        stderr += chunk.toString('utf8')
    })
    const readinessLine: string = await new Promise<string>((resolveLine, rejectLine) => {
        let settled: boolean = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            rejectLine(new Error(
                `vtd readiness line not seen within ${STARTUP_TIMEOUT_MS}ms.\n` +
                `stdout=${stdout}\nstderr=${stderr}`,
            ))
        }, STARTUP_TIMEOUT_MS)
        const onData = (): void => {
            if (settled) return
            const match = READINESS_REGEX.exec(stdout)
            if (match) {
                settled = true
                clearTimeout(timer)
                resolveLine(match[0])
            }
        }
        child.stdout!.on('data', onData)
        child.once('exit', (code, signal) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            rejectLine(new Error(
                `vtd exited (code=${code} signal=${signal}) before readiness.\n` +
                `stdout=${stdout}\nstderr=${stderr}`,
            ))
        })
    })
    const match = READINESS_REGEX.exec(readinessLine)
    if (!match) throw new Error(`readiness line did not match contract: ${readinessLine}`)
    return {child, httpUrl: match[1], gdbPort: Number(match[3])}
}

async function readAuthToken(project: string): Promise<string> {
    return (await readFile(join(project, '.voicetree', 'auth-token'), 'utf8')).trim()
}

type RpcResponse = {
    readonly jsonrpc: '2.0'
    readonly id: number | string | null
    readonly result?: unknown
    readonly error?: {readonly code: number; readonly message: string; readonly data?: unknown}
}

async function postRpc(
    httpUrl: string,
    token: string,
    method: string,
    params: Record<string, unknown>,
): Promise<RpcResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)
    try {
        const res = await fetch(`${httpUrl.replace(/\/$/, '')}/rpc`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
            signal: controller.signal,
        })
        return await res.json() as RpcResponse
    } finally {
        clearTimeout(timer)
    }
}

async function waitForChildExit(
    child: ChildProcess,
    deadlineMs: number,
): Promise<{code: number | null; signal: NodeJS.Signals | null}> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return {code: child.exitCode, signal: child.signalCode as NodeJS.Signals | null}
    }
    return await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`child did not exit within ${deadlineMs}ms`)), deadlineMs)
        child.once('exit', (code, signal) => {
            clearTimeout(timer)
            res({code, signal})
        })
    })
}

describe('vtd binary — MCP graph bridge is wired at boot (BF-376 regression)', () => {
    const cleanup: Array<() => Promise<void>> = []

    afterEach(async () => {
        while (cleanup.length > 0) {
            const fn = cleanup.pop()
            if (fn) await fn().catch(() => undefined)
        }
    })

    it('list_agents over /rpc returns a success envelope (NOT "MCP graph bridge not configured")', async () => {
        const project: string = await makeTempProject('vtd-bridge-')
        cleanup.push(async () => {
            for (const pid of listGraphdPidsForProject(project)) killForgiving(pid, 'SIGKILL')
            await rm(project, {recursive: true, force: true})
        })

        const launch: LaunchOutcome = await spawnRealVtd(project)
        cleanup.push(async () => {
            if (launch.child.exitCode === null) {
                killForgiving(launch.child.pid!, 'SIGTERM')
                await waitForChildExit(launch.child, SHUTDOWN_TIMEOUT_MS).catch(() => undefined)
            }
        })

        const token: string = await readAuthToken(project)
        const response: RpcResponse = await postRpc(launch.httpUrl, token, 'list_agents', {})

        // The bug returns error=tool_handler_failed with the bridge message
        // embedded in error.data. If the bridge is wired, list_agents returns
        // a result object with `success: true, agents: [], availableAgents:
        // [...]`. Assert both branches so a future drift (e.g. payload moves
        // out of error.data) still surfaces.
        const responseText: string = JSON.stringify(response)
        expect(responseText).not.toMatch(/MCP graph bridge not configured/)

        expect(response.error).toBeUndefined()
        expect(response.result).toBeDefined()
        const result = response.result as {success: boolean; agents: readonly unknown[]; availableAgents: readonly unknown[]}
        expect(result.success).toBe(true)
        expect(Array.isArray(result.agents)).toBe(true)
        expect(Array.isArray(result.availableAgents)).toBe(true)
    }, 90_000)
})
