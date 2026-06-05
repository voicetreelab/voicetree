/**
 * Black-box tests for the mandatory `--status` carrier on `vt graph create`.
 *
 * Policy: an agent (a caller terminal is present) MUST declare its lifecycle
 * status when it creates nodes; offline authoring (no terminal) is unrestricted.
 * Filesystem authoring writes to disk without touching the daemon, so the
 * declared status is reported out-of-band via an `apply_agent_status` RPC after
 * a successful write — asserted here against a recording stub daemon.
 */
import {access, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {clearLoadSchemaPluginCacheForTest} from '../core/loadSchemaPlugin'
import {
    captureGraphCreate,
    setupGatedProject,
    startStubDaemon,
    type CapturedRun,
    type StubDaemon,
} from './graphCreateHarness'

const TERMINAL_ID: string = 'ctx-nodes/caller.md-terminal-0'

describe('graph create --status (mandatory agent status)', () => {
    let originalStdoutIsTTY: PropertyDescriptor | undefined
    let projectRoot: string
    let savedDaemonUrl: string | undefined
    let savedProjectPath: string | undefined

    beforeAll(() => {
        originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
        Object.defineProperty(process.stdout, 'isTTY', {value: false, configurable: true})
    })

    afterAll(() => {
        if (originalStdoutIsTTY) {
            Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
        }
    })

    beforeEach(async () => {
        projectRoot = await setupGatedProject()
        savedDaemonUrl = process.env.VOICETREE_DAEMON_URL
        savedProjectPath = process.env.VOICETREE_PROJECT_PATH
    })

    afterEach(async () => {
        clearLoadSchemaPluginCacheForTest()
        await rm(projectRoot, {recursive: true, force: true})
        restoreEnv('VOICETREE_DAEMON_URL', savedDaemonUrl)
        restoreEnv('VOICETREE_PROJECT_PATH', savedProjectPath)
    })

    function restoreEnv(key: string, value: string | undefined): void {
        if (value === undefined) {
            delete process.env[key]
        } else {
            process.env[key] = value
        }
    }

    it('rejects a create from an agent terminal that omits --status', async () => {
        await writeFile(join(projectRoot, 'work', 'a.md'), '# A\n\nNeeded marker present.\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(
            ['work/a.md', '--parent', 'work/work.md'],
            projectRoot,
            {terminalId: TERMINAL_ID},
        )

        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('--status')
        // The write must not have happened — status is required before any node lands.
        await expect(access(join(projectRoot, 'work', 'a.md'))).resolves.toBeUndefined()
    })

    it('allows offline authoring (no terminal) to omit --status', async () => {
        await writeFile(join(projectRoot, 'work', 'a.md'), '# A\n\nNeeded marker present.\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(
            ['work/a.md', '--parent', 'work/work.md'],
            projectRoot,
        )

        expect(result.exitCode).toBeNull()
        const payload = JSON.parse(result.stdout)
        expect(payload.summary).toMatchObject({ok: 1, rejected: 0})
    })

    it('rejects an unknown --status value before doing any work', async () => {
        const result: CapturedRun = await captureGraphCreate(
            ['work/a.md', '--parent', 'work/work.md', '--status', 'finished'],
            projectRoot,
            {terminalId: TERMINAL_ID},
        )

        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('working')
    })

    it('exempts --validate-only from the status requirement (no write happens)', async () => {
        await writeFile(join(projectRoot, 'work', 'a.md'), '# A\n\nNeeded marker present.\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(
            ['work/a.md', '--parent', 'work/work.md', '--validate-only'],
            projectRoot,
            {terminalId: TERMINAL_ID},
        )

        expect(result.exitCode).toBeNull()
        const payload = JSON.parse(result.stdout)
        expect(payload.nodes[0]).toMatchObject({status: 'ok'})
    })

    it('reports the declared status to the daemon after a filesystem write', async () => {
        const stub: StubDaemon = await startStubDaemon({success: true, terminalId: TERMINAL_ID})
        process.env.VOICETREE_DAEMON_URL = stub.url
        process.env.VOICETREE_PROJECT_PATH = stub.projectPath
        try {
            await writeFile(join(projectRoot, 'work', 'a.md'), '# A\n\nNeeded marker present.\n', 'utf8')

            const result: CapturedRun = await captureGraphCreate(
                ['work/a.md', '--parent', 'work/work.md', '--status', 'done', '--phrase', 'shipped the verb'],
                projectRoot,
                {terminalId: TERMINAL_ID},
            )

            expect(result.exitCode).toBeNull()
            const statusCalls = stub.requests.filter((r) => r.method === 'apply_agent_status')
            expect(statusCalls).toHaveLength(1)
            expect(statusCalls[0].params).toMatchObject({
                callerTerminalId: TERMINAL_ID,
                preset: 'done',
                statusPhrase: 'shipped the verb',
            })
        } finally {
            await stub.stop()
        }
    })
})
