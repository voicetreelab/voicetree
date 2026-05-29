import {access, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {clearLoadSchemaPluginCacheForTest} from '../core/loadSchemaPlugin'
import {
    __resetCliInvocationSinkForTests,
    installCliInvocationSink,
    setInvocationContext,
    type CliInvocationRecord,
    type SinkDeps,
} from '../../telemetry/recordCliInvocation'
import {
    captureGraphCreate,
    SCHEMAS_TWO_RULES,
    setupGatedVault,
    startStubDaemon,
    type CapturedRun,
    type StubDaemon,
} from './graphCreateHarness'

describe('graph create batch reporting (filesystem mode)', () => {
    let originalStdoutIsTTY: PropertyDescriptor | undefined
    let vaultRoot: string

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
        vaultRoot = await setupGatedVault()
    })

    afterEach(async () => {
        clearLoadSchemaPluginCacheForTest()
        await rm(vaultRoot, {recursive: true, force: true})
    })

    it('case 1: all-ok batch — two valid files exit 0 with two ok verdicts', async () => {
        await writeFile(join(vaultRoot, 'work', 'a.md'), '# A\n\nNeeded marker present.\n', 'utf8')
        await writeFile(join(vaultRoot, 'work', 'b.md'), '# B\n\nNeeded marker present.\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(['work/a.md', 'work/b.md'], vaultRoot)

        expect(result.exitCode).toBeNull()
        const payload = JSON.parse(result.stdout)
        expect(payload).toMatchObject({
            kind: 'graph_create_batch_result',
            nodes: [
                {path: 'work/a.md', status: 'ok'},
                {path: 'work/b.md', status: 'ok'},
            ],
            summary: {ok: 2, rejected: 0, skipped: 0, warning: 0},
        })
        await expect(access(join(vaultRoot, 'work', 'a.md'))).resolves.toBeUndefined()
        await expect(access(join(vaultRoot, 'work', 'b.md'))).resolves.toBeUndefined()
    })

    it('case 2: mixed batch — gate-all evaluates both nodes; rejected and ok both visible', async () => {
        await writeFile(join(vaultRoot, 'work', 'a.md'), '# A\n\nNeeded marker present.\n', 'utf8')
        const bOriginal: string = '# B\n\nno marker here\n'
        await writeFile(join(vaultRoot, 'work', 'b.md'), bOriginal, 'utf8')

        const result: CapturedRun = await captureGraphCreate(['work/a.md', 'work/b.md'], vaultRoot)

        expect(result.exitCode).toBe(1)
        const payload = JSON.parse(result.stderr.trim())
        expect(payload).toMatchObject({
            kind: 'graph_create_batch_result',
            nodes: [
                {path: 'work/a.md', status: 'ok'},
                {path: 'work/b.md', status: 'rejected', ruleIds: ['body.missing_needed_marker']},
            ],
            summary: {ok: 1, rejected: 1, skipped: 0, warning: 0},
        })
        expect(await readFile(join(vaultRoot, 'work', 'b.md'), 'utf8')).toBe(bOriginal)
    })

    it('case 3: all-rejected batch — three rejections all visible with ruleIds', async () => {
        await writeFile(join(vaultRoot, 'work', 'a.md'), '# A\n\nbody one\n', 'utf8')
        await writeFile(join(vaultRoot, 'work', 'b.md'), '# B\n\nbody two\n', 'utf8')
        await writeFile(join(vaultRoot, 'work', 'c.md'), '# C\n\nbody three\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(
            ['work/a.md', 'work/b.md', 'work/c.md'],
            vaultRoot,
        )

        expect(result.exitCode).toBe(1)
        const payload = JSON.parse(result.stderr.trim())
        expect(payload.nodes).toHaveLength(3)
        for (const node of payload.nodes) {
            expect(node.status).toBe('rejected')
            expect(node.ruleIds).toEqual(['body.missing_needed_marker'])
        }
        expect(payload.summary).toEqual({ok: 0, rejected: 3, skipped: 0, warning: 0})
    })

    it('case 4: typeless folder is silent — gate emits ok with no skipReason', async () => {
        const freeDir: string = join(vaultRoot, 'free')
        await mkdir(freeDir, {recursive: true})
        await writeFile(join(freeDir, 'note.md'), '# Free\n\nanything goes\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(['free/note.md'], vaultRoot)

        expect(result.exitCode).toBeNull()
        const payload = JSON.parse(result.stdout)
        expect(payload).toMatchObject({
            kind: 'graph_create_batch_result',
            nodes: [{path: 'free/note.md', status: 'ok'}],
            summary: {ok: 1, rejected: 0, skipped: 0, warning: 0},
        })
        // No upstream `## Type` was declared, so the verdict must not carry a
        // `skipReason` (or any of the schema-gate fields) — the gate is silent.
        expect(payload.nodes[0]).not.toHaveProperty('skipReason')
        expect(payload.nodes[0]).not.toHaveProperty('typeName')
        expect(payload.nodes[0]).not.toHaveProperty('schemaPath')
        await expect(access(join(freeDir, 'note.md'))).resolves.toBeUndefined()
    })

    it('case 6: empty batch — no inputs surfaces a non-zero exit', async () => {
        const result: CapturedRun = await captureGraphCreate([], vaultRoot, {terminalId: 't'})

        expect(result.exitCode).toBe(1)
        expect(result.stderr).toMatch(/^error:/)
    })

    it('case 8: JSON envelope shape — top-level kind/nodes/summary present', async () => {
        await writeFile(join(vaultRoot, 'work', 'a.md'), '# A\n\nNeeded marker.\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(['work/a.md'], vaultRoot)

        expect(result.exitCode).toBeNull()
        const payload = JSON.parse(result.stdout)
        expect(Object.keys(payload).sort()).toEqual(['kind', 'nodes', 'summary'])
        expect(payload.kind).toBe('graph_create_batch_result')
        expect(Array.isArray(payload.nodes)).toBe(true)
        expect(payload.summary).toMatchObject({
            ok: expect.any(Number),
            rejected: expect.any(Number),
            skipped: expect.any(Number),
            warning: expect.any(Number),
        })
    })

    it('case 9: stderr-vs-stdout split — rejection envelope on stderr, success envelope on stdout', async () => {
        await writeFile(join(vaultRoot, 'work', 'good.md'), '# G\n\nNeeded marker.\n', 'utf8')
        const okOnly: CapturedRun = await captureGraphCreate(['work/good.md'], vaultRoot)
        expect(okOnly.stdout).toContain('graph_create_batch_result')
        expect(okOnly.stderr).toBe('')

        await writeFile(join(vaultRoot, 'work', 'bad.md'), '# B\n\nno marker\n', 'utf8')
        const rejected: CapturedRun = await captureGraphCreate(['work/bad.md'], vaultRoot)
        expect(rejected.stderr).toContain('graph_create_batch_result')
        expect(rejected.stdout).toBe('')
    })
})

describe('graph create batch reporting (live mode + HTTP daemon)', () => {
    let originalStdoutIsTTY: PropertyDescriptor | undefined
    let originalDaemonUrl: string | undefined
    let originalVaultPath: string | undefined
    let vaultRoot: string
    let parentNodeId: string
    let stub: StubDaemon

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
        vaultRoot = await setupGatedVault()
        parentNodeId = join(vaultRoot, 'work', 'parent.md')
        await writeFile(parentNodeId, '# Parent\n\nNeeded marker.\n', 'utf8')
        originalDaemonUrl = process.env.VOICETREE_DAEMON_URL
        originalVaultPath = process.env.VOICETREE_PROJECT_PATH
    })

    afterEach(async () => {
        if (stub) await stub.stop()
        if (originalDaemonUrl === undefined) delete process.env.VOICETREE_DAEMON_URL
        else process.env.VOICETREE_DAEMON_URL = originalDaemonUrl
        if (originalVaultPath === undefined) delete process.env.VOICETREE_PROJECT_PATH
        else process.env.VOICETREE_PROJECT_PATH = originalVaultPath
        clearLoadSchemaPluginCacheForTest()
        await rm(vaultRoot, {recursive: true, force: true})
    })

    it('case 5: daemon warning surfaces as warning verdict — node was created, exit 0', async () => {
        stub = await startStubDaemon({
            success: true,
            nodes: [
                {
                    id: 'topic-c',
                    path: join(vaultRoot, 'work', 'topic-c.md'),
                    status: 'warning',
                    warning: 'mermaid parse failed — fix at topic-c',
                },
            ],
        })
        process.env.VOICETREE_DAEMON_URL = stub.url
        process.env.VOICETREE_PROJECT_PATH = stub.vaultPath

        const result: CapturedRun = await captureGraphCreate(
            [
                '--node',
                'Topic C::Summary C::Needed marker present.',
                '--parent',
                parentNodeId,
            ],
            vaultRoot,
            {terminalId: 't'},
        )

        expect(result.exitCode).toBeNull()
        const payload = JSON.parse(result.stdout)
        expect(payload.summary).toEqual({ok: 0, rejected: 0, skipped: 0, warning: 1})
        expect(payload.nodes[0]).toMatchObject({
            status: 'warning',
            warning: expect.stringContaining('mermaid'),
        })
    })

    it('case 7: --override per-node — override applied, verdict ok with overriddenRuleIds', async () => {
        stub = await startStubDaemon({
            success: true,
            nodes: [
                {
                    id: 'topic-d',
                    path: join(vaultRoot, 'work', 'topic-d.md'),
                    status: 'ok',
                },
            ],
        })
        process.env.VOICETREE_DAEMON_URL = stub.url
        process.env.VOICETREE_PROJECT_PATH = stub.vaultPath

        const result: CapturedRun = await captureGraphCreate(
            [
                '--node',
                'Topic D::Summary D::Needed marker present.',
                '--parent',
                parentNodeId,
                '--override',
                'node_line_limit:big rewrite',
            ],
            vaultRoot,
            {terminalId: 't'},
        )

        expect(result.exitCode).toBeNull()
        const payload = JSON.parse(result.stdout)
        expect(payload.summary).toEqual({ok: 1, rejected: 0, skipped: 0, warning: 0})
        expect(payload.nodes[0]).toMatchObject({
            status: 'ok',
            overriddenRuleIds: ['node_line_limit'],
        })
    })
})

interface CapturedAppend {
    readonly filePath: string
    readonly line: string
}

interface TelemetryHarness {
    readonly appended: CapturedAppend[]
    readonly registeredHandlers: Array<() => void>
    readonly deps: SinkDeps
}

function makeTelemetryHarness(): TelemetryHarness {
    const appended: CapturedAppend[] = []
    const registeredHandlers: Array<() => void> = []
    return {
        appended,
        registeredHandlers,
        deps: {
            appendFileSync: (filePath: string, line: string): void => {
                appended.push({filePath, line})
            },
            mkdirSync: (): void => {},
            register: (handler: () => void): void => {
                registeredHandlers.push(handler)
            },
            now: (): number => 1_000,
            nowIso: (): string => '2026-05-21T00:00:00.000Z',
            getEnv: (): string | undefined => undefined,
            getExitCode: (): number => 1,
        },
    }
}

describe('graph create batch reporting — telemetry union ruleIds', () => {
    let originalStdoutIsTTY: PropertyDescriptor | undefined
    let vaultRoot: string
    let harness: TelemetryHarness

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
        vaultRoot = await setupGatedVault(SCHEMAS_TWO_RULES)
        harness = makeTelemetryHarness()
        __resetCliInvocationSinkForTests()
        installCliInvocationSink({
            filePath: '/tmp/x/cli-telemetry.jsonl',
            vtVersion: '0.0.1-test',
            startMs: 0,
            deps: harness.deps,
        })
        setInvocationContext({verb: 'graph create', argsShape: 'graph create <args>'})
    })

    afterEach(async () => {
        __resetCliInvocationSinkForTests()
        clearLoadSchemaPluginCacheForTest()
        await rm(vaultRoot, {recursive: true, force: true})
    })

    it('case 10: gate_rejection.ruleIds records the union of all rejected nodes ruleIds', async () => {
        await writeFile(
            join(vaultRoot, 'work', 'a.md'),
            '# A\n\nbody with Needed marker present\n',
            'utf8',
        )
        await writeFile(join(vaultRoot, 'work', 'b.md'), '# B\n\nbody is bare\n', 'utf8')
        await writeFile(join(vaultRoot, 'work', 'c.md'), '# C\n\nbody with Required tag\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(
            ['work/a.md', 'work/b.md', 'work/c.md'],
            vaultRoot,
        )

        expect(result.exitCode).toBe(1)
        harness.registeredHandlers[0]()
        expect(harness.appended).toHaveLength(1)
        const record: CliInvocationRecord = JSON.parse(harness.appended[0].line)
        expect(record.error_class).toBe('SchemaViolation')
        expect(record.gate_rejection).not.toBeNull()
        expect(record.gate_rejection!.ruleIds).toEqual(
            expect.arrayContaining(['body.missing_needed_marker', 'body.missing_required_tag']),
        )
        expect(record.gate_rejection!.ruleIds.length).toBeGreaterThanOrEqual(2)
    })
})

describe('graph create batch reporting — human format (TTY mode)', () => {
    let originalStdoutIsTTY: PropertyDescriptor | undefined
    let vaultRoot: string

    beforeAll(() => {
        originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
        Object.defineProperty(process.stdout, 'isTTY', {value: true, configurable: true})
    })

    afterAll(() => {
        if (originalStdoutIsTTY) {
            Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
        }
    })

    beforeEach(async () => {
        vaultRoot = await setupGatedVault()
    })

    afterEach(async () => {
        clearLoadSchemaPluginCacheForTest()
        await rm(vaultRoot, {recursive: true, force: true})
    })

    it('emits per-node lines and a summary line in human/TTY mode', async () => {
        await writeFile(join(vaultRoot, 'work', 'good.md'), '# G\n\nNeeded marker.\n', 'utf8')
        await writeFile(join(vaultRoot, 'work', 'bad.md'), '# B\n\nno marker\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(
            ['work/good.md', 'work/bad.md'],
            vaultRoot,
        )

        expect(result.exitCode).toBe(1)
        expect(result.stdout).toMatch(/✓ work\/good\.md/)
        expect(result.stderr).toMatch(/✗ work\/bad\.md/)
        expect(result.stderr).toContain('[body.missing_needed_marker]')
        expect(result.stderr).toMatch(/rerun with --override 'body\.missing_needed_marker:/)
        expect(result.stdout).toMatch(/Summary: 1 ok, 1 rejected, 0 skipped, 0 warning\. Exit 1\./)
    })
})
