import {access, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance} from 'vitest'
import {graphCreate} from '../core/graph'
import {clearLoadSchemaPluginCacheForTest} from '../core/loadSchemaPlugin'
import {CliError} from '@voicetree/cli/commands/output'

class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

type CapturedRun = {
    exitCode: number | null
    stdout: string
    stderr: string
}

async function captureGraphCreate(
    args: string[],
    cwd: string,
    options: {terminalId?: string} = {}
): Promise<CapturedRun> {
    const stdoutLines: string[] = []
    const stderrChunks: string[] = []
    const originalCwd: string = process.cwd()
    const logSpy: MockInstance<typeof console.log> = vi
        .spyOn(console, 'log')
        .mockImplementation((...values: unknown[]): void => {
            stdoutLines.push(values.map((value: unknown): string => String(value)).join(' '))
        })
    const stderrSpy: MockInstance<typeof process.stderr.write> = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(((chunk: unknown) => {
            stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk))
            return true
        }) as typeof process.stderr.write)
    const errorSpy: MockInstance<typeof console.error> = vi
        .spyOn(console, 'error')
        .mockImplementation((...values: unknown[]): void => {
            stderrChunks.push(`${values.map((value: unknown): string => String(value)).join(' ')}\n`)
        })
    const exitSpy: MockInstance<typeof process.exit> = vi
        .spyOn(process, 'exit')
        .mockImplementation(((code?: number) => {
            throw new ExitCalled(code ?? 0)
        }) as typeof process.exit)

    process.chdir(cwd)
    let exitCode: number | null = null
    try {
        await graphCreate(options.terminalId, args)
    } catch (err) {
        if (err instanceof ExitCalled) {
            exitCode = err.code
        } else if (err instanceof CliError) {
            stderrChunks.push(`error: ${err.message}\n`)
            exitCode = 1
        } else {
            throw err
        }
    } finally {
        process.chdir(originalCwd)
        logSpy.mockRestore()
        stderrSpy.mockRestore()
        errorSpy.mockRestore()
        exitSpy.mockRestore()
    }

    return {
        exitCode,
        stdout: stdoutLines.join('\n'),
        stderr: stderrChunks.join(''),
    }
}

const SCHEMAS_REQUIRES_NEEDED_MARKER: string = `module.exports = {
    "my-kind": {
        validate(rawBody) {
            if (rawBody.includes("Needed marker")) {
                return []
            }
            return [
                {
                    ruleId: "body.missing_needed_marker",
                    message: "body must include the phrase 'Needed marker'",
                    severity: "error",
                }
            ]
        }
    }
}
`

const FOLDER_NOTE_BODY: string = '# Work\n\n## Type: my-kind\n\nfolder note body\n'

describe('graph create schema gate (filesystem mode)', () => {
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
        vaultRoot = await realpath(await mkdtemp(join(tmpdir(), 'vt-schema-gate-')))
        await mkdir(join(vaultRoot, '.voicetree'), {recursive: true})
        await writeFile(join(vaultRoot, '.voicetree', 'schemas.cjs'), SCHEMAS_REQUIRES_NEEDED_MARKER, 'utf8')
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(join(workDir, 'work.md'), FOLDER_NOTE_BODY, 'utf8')
        clearLoadSchemaPluginCacheForTest()
    })

    afterEach(async () => {
        clearLoadSchemaPluginCacheForTest()
        await rm(vaultRoot, {recursive: true, force: true})
    })

    it('writes the file when the body satisfies the schema', async () => {
        const targetPath: string = join(vaultRoot, 'work', 'topic.md')
        await writeFile(targetPath, '# Topic\n\nNeeded marker present.\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(['work/topic.md'], vaultRoot)

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        const written: string = await readFile(targetPath, 'utf8')
        expect(written).toContain('# Topic')
    })

    it('rejects an invalid body with a structured batch envelope and does not overwrite the file', async () => {
        const targetPath: string = join(vaultRoot, 'work', 'topic.md')
        const originalBody: string = '# Topic\n\nthis body lacks the marker\n'
        await writeFile(targetPath, originalBody, 'utf8')

        const result: CapturedRun = await captureGraphCreate(['work/topic.md'], vaultRoot)

        expect(result.exitCode).toBe(1)
        const payload: unknown = JSON.parse(result.stderr.trim())
        expect(payload).toMatchObject({
            kind: 'graph_create_batch_result',
            nodes: [
                {
                    path: 'work/topic.md',
                    status: 'rejected',
                    typeName: 'my-kind',
                    ruleIds: ['body.missing_needed_marker'],
                },
            ],
            summary: {ok: 0, rejected: 1, skipped: 0, warning: 0},
        })
        const onDisk: string = await readFile(targetPath, 'utf8')
        expect(onDisk).toBe(originalBody)
    })

    it('runs the gate before --validate-only and does not write when validation passes', async () => {
        const targetPath: string = join(vaultRoot, 'work', 'topic.md')
        await writeFile(targetPath, '# Topic\n\nNeeded marker here.\n', 'utf8')
        const originalBody: string = await readFile(targetPath, 'utf8')

        const result: CapturedRun = await captureGraphCreate(['work/topic.md', '--validate-only'], vaultRoot)

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({
            kind: 'graph_create_batch_result',
            nodes: [{path: 'work/topic.md', status: 'ok'}],
            summary: {ok: 1, rejected: 0, skipped: 0, warning: 0},
        })
        expect(await readFile(targetPath, 'utf8')).toBe(originalBody)
    })

    it('rejects --validate-only when the gate fails', async () => {
        const targetPath: string = join(vaultRoot, 'work', 'topic.md')
        await writeFile(targetPath, '# Topic\n\nno marker\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(['work/topic.md', '--validate-only'], vaultRoot)

        expect(result.exitCode).toBe(1)
        const payload: unknown = JSON.parse(result.stderr.trim())
        expect(payload).toMatchObject({
            kind: 'graph_create_batch_result',
            nodes: [{path: 'work/topic.md', status: 'rejected', typeName: 'my-kind'}],
            summary: {ok: 0, rejected: 1, skipped: 0, warning: 0},
        })
    })

    it('rejects --override flags in filesystem mode (CLI gate is non-overridable)', async () => {
        const targetPath: string = join(vaultRoot, 'work', 'topic.md')
        await writeFile(targetPath, '# Topic\n\nNeeded marker.\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(
            ['work/topic.md', '--override', 'node_line_limit:reason'],
            vaultRoot
        )

        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('--override is only valid with live-mode')
    })

    it('skips validation when no upstream folder note declares a Type', async () => {
        const freeDir: string = join(vaultRoot, 'free')
        await mkdir(freeDir, {recursive: true})
        const targetPath: string = join(freeDir, 'node.md')
        await writeFile(targetPath, '# Free\n\nanything goes\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(['free/node.md'], vaultRoot)

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        await expect(access(targetPath)).resolves.toBeUndefined()
    })

    it('skips validation when no schemas.cjs is present', async () => {
        await rm(join(vaultRoot, '.voicetree', 'schemas.cjs'), {force: true})
        clearLoadSchemaPluginCacheForTest()

        const targetPath: string = join(vaultRoot, 'work', 'topic.md')
        await writeFile(targetPath, '# Topic\n\nno marker here\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(['work/topic.md'], vaultRoot)

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
    })

    it('skips validation when the folder note declares an unknown type', async () => {
        await writeFile(
            join(vaultRoot, 'work', 'work.md'),
            '# Work\n\n## Type: unregistered-kind\n',
            'utf8'
        )
        const targetPath: string = join(vaultRoot, 'work', 'topic.md')
        await writeFile(targetPath, '# Topic\n\nno marker\n', 'utf8')

        const result: CapturedRun = await captureGraphCreate(['work/topic.md'], vaultRoot)

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
    })
})

describe('graph create schema gate (live mode)', () => {
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
        vaultRoot = await realpath(await mkdtemp(join(tmpdir(), 'vt-schema-gate-live-')))
        await mkdir(join(vaultRoot, '.voicetree'), {recursive: true})
        await writeFile(join(vaultRoot, '.voicetree', 'schemas.cjs'), SCHEMAS_REQUIRES_NEEDED_MARKER, 'utf8')
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(join(workDir, 'work.md'), FOLDER_NOTE_BODY, 'utf8')
        await writeFile(join(workDir, 'parent.md'), '# Parent\n', 'utf8')
        clearLoadSchemaPluginCacheForTest()
    })

    afterEach(async () => {
        clearLoadSchemaPluginCacheForTest()
        await rm(vaultRoot, {recursive: true, force: true})
    })

    it('rejects an invalid live-mode node before invoking MCP', async () => {
        const parentNodeId: string = join(vaultRoot, 'work', 'parent.md')

        const result: CapturedRun = await captureGraphCreate(
            [
                '--node',
                'My Title::Short summary::body has no marker',
                '--parent',
                parentNodeId,
            ],
            vaultRoot,
            {terminalId: 'test-terminal'}
        )

        expect(result.exitCode).toBe(1)
        const payload: unknown = JSON.parse(result.stderr.trim())
        expect(payload).toMatchObject({
            kind: 'graph_create_batch_result',
            nodes: [
                {
                    status: 'rejected',
                    typeName: 'my-kind',
                    ruleIds: ['body.missing_needed_marker'],
                },
            ],
            summary: {ok: 0, rejected: 1, skipped: 0, warning: 0},
        })
    })
})
