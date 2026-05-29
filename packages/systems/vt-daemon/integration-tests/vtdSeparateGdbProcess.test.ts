/**
 * Refactor regression for BF-371: VTD must NOT embed vt-graphd.
 *
 * Before BF-371, `bin/vt-mcpd.ts` started graph-db-server in-process via
 * `startDaemon({vault, voicetreeHomePath})`. After BF-371, `bin/vtd.ts` calls
 * `ensureGraphDaemonForVault('vtd')` which spawns vt-graphd as a SIBLING
 * process (or adopts an existing one). This test asserts that observable
 * structural fact via `ps`: after vtd readiness we should see at least one
 * fake-vt-graphd process whose --project-root matches our vault, in addition
 * to our spawned vtd. If a future refactor accidentally re-embeds graphd,
 * this test fails because no graphd process exists.
 */

import {spawn, spawnSync, type ChildProcess} from 'node:child_process'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR: string = resolve(TEST_FILE_DIR, '..')
const REPO_ROOT: string = resolve(PACKAGE_DIR, '../../..')
const VTD_ENTRYPOINT: string = join(PACKAGE_DIR, 'bin/vtd.ts')
const FAKE_GRAPHD_BIN: string = join(
    REPO_ROOT,
    'packages/systems/graph-db-client/src/__tests__/fixtures/fake-vt-graphd.mjs',
)

const TSX_REQUIRE = createRequire(import.meta.url)
const TSX_PACKAGE_DIR: string = dirname(TSX_REQUIRE.resolve('tsx/package.json'))
const TSX_CLI_PATH: string = join(TSX_PACKAGE_DIR, 'dist', 'cli.mjs')
const NODE_BIN: string = process.execPath
const VT_GRAPHD_BIN_OVERRIDE: string = `${NODE_BIN} ${FAKE_GRAPHD_BIN}`

const STARTUP_TIMEOUT_MS: number = 20_000

const READINESS_REGEX = /^vtd: listening on (https?:\/\/[^,]+), vault=(\S+), gdb=(\d+)$/m

function sleep(ms: number): Promise<void> {
    return new Promise<void>((res) => setTimeout(res, ms))
}

function killForgiving(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
    try {
        process.kill(pid, signal)
    } catch {
        // already gone
    }
}

function listProcessesForVault(vault: string): Array<{pid: number; commandLine: string}> {
    if (process.platform !== 'darwin' && process.platform !== 'linux') return []
    const canonical = resolve(vault)
    const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], {
        encoding: 'utf8',
        timeout: 5000,
    })
    if (result.status !== 0 || !result.stdout) return []
    const matches: Array<{pid: number; commandLine: string}> = []
    for (const line of result.stdout.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const pidStr = trimmed.split(/\s+/, 1)[0]
        const pid = Number(pidStr)
        if (!Number.isInteger(pid) || pid <= 0) continue
        const command = trimmed.substring(pidStr.length).trim()
        // Match either the canonical vault flag for graphd or our own vtd command.
        const graphdMatch = /(vt-graphd|fake-vt-graphd)\.\w+\b.*--project-root\s+(\S+)/.exec(command)
        if (graphdMatch && resolve(graphdMatch[2]) === canonical) {
            matches.push({pid, commandLine: command})
            continue
        }
        const vtdMatch = /vtd\.ts.*--vault\s+(\S+)/.exec(command)
        if (vtdMatch && resolve(vtdMatch[1]) === canonical) {
            matches.push({pid, commandLine: command})
        }
    }
    return matches
}

async function spawnVtdAndAwaitReady(vault: string): Promise<{child: ChildProcess; stdout: string}> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries({...process.env, VT_GRAPHD_BIN: VT_GRAPHD_BIN_OVERRIDE})) {
        if (v !== undefined) env[k] = v
    }
    const child = spawn(
        NODE_BIN,
        [TSX_CLI_PATH, VTD_ENTRYPOINT, '--vault', vault, '--port', '0'],
        {cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: false},
    )
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (chunk: Buffer): void => {
        stdout += chunk.toString('utf8')
    })
    child.stderr!.on('data', (chunk: Buffer): void => {
        stderr += chunk.toString('utf8')
    })
    await new Promise<void>((res, rej) => {
        const timer = setTimeout(() => rej(new Error(
            `vtd did not become ready in ${STARTUP_TIMEOUT_MS}ms.\nstdout=${stdout}\nstderr=${stderr}`,
        )), STARTUP_TIMEOUT_MS)
        const onData = (): void => {
            if (READINESS_REGEX.test(stdout)) {
                clearTimeout(timer)
                res()
            }
        }
        child.stdout!.on('data', onData)
        child.once('exit', (code, signal) => {
            clearTimeout(timer)
            rej(new Error(
                `vtd exited early (code=${code} signal=${signal}).\nstdout=${stdout}\nstderr=${stderr}`,
            ))
        })
    })
    return {child, stdout}
}

async function makeVault(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    await mkdir(join(dir, '.voicetree'), {recursive: true})
    return dir
}

describe('vtd does not embed vt-graphd (BF-371 refactor regression)', () => {
    const cleanup: Array<() => Promise<void>> = []

    afterEach(async () => {
        while (cleanup.length > 0) {
            const fn = cleanup.pop()
            if (fn) await fn().catch(() => undefined)
        }
    })

    it('after vtd readiness, ps shows two distinct daemon processes: vtd + vt-graphd', async () => {
        const vault = await makeVault('vtd-separate-')
        cleanup.push(async () => {
            for (const proc of listProcessesForVault(vault)) killForgiving(proc.pid)
            await rm(vault, {recursive: true, force: true})
        })

        const {child} = await spawnVtdAndAwaitReady(vault)
        cleanup.push(async () => {
            if (child.exitCode === null) killForgiving(child.pid!, 'SIGTERM')
            await sleep(500)
        })

        // Give the OS a beat to register both processes in ps.
        await sleep(200)

        const procs = listProcessesForVault(vault)
        // We expect at least one vtd process AND at least one graphd process.
        const graphdProcs = procs.filter((p) =>
            /(vt-graphd|fake-vt-graphd)\.\w+\b/.test(p.commandLine),
        )
        const vtdProcs = procs.filter((p) => /vtd\.ts/.test(p.commandLine))

        expect(
            graphdProcs.length,
            `expected at least 1 vt-graphd process for vault=${vault}; got ${procs.length} matches:\n${procs.map((p) => `  pid=${p.pid} ${p.commandLine}`).join('\n')}`,
        ).toBeGreaterThanOrEqual(1)
        expect(
            vtdProcs.length,
            `expected at least 1 vtd process for vault=${vault}; got ${procs.length} matches`,
        ).toBeGreaterThanOrEqual(1)

        // The pids must be distinct — if vtd embeds graphd then a single pid
        // would match both predicates (unlikely given the regex shapes, but
        // assert anyway).
        const allPids = new Set([...graphdProcs.map((p) => p.pid), ...vtdProcs.map((p) => p.pid)])
        expect(allPids.size).toBeGreaterThanOrEqual(2)
    }, 60_000)
})
