import {mkdir, mkdtemp, realpath, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {vi, type MockInstance} from 'vitest'
import {graphCreate} from '@/shell/edge/main/cli/commands/graph/core/graph'
import {clearLoadSchemaPluginCacheForTest} from '@/shell/edge/main/cli/commands/graph/core/loadSchemaPlugin'

export class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

export type CapturedRun = {
    exitCode: number | null
    stdout: string
    stderr: string
}

export async function captureGraphCreate(
    args: string[],
    cwd: string,
    options: {terminalId?: string} = {},
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
        await graphCreate(0, options.terminalId, args)
    } catch (err) {
        if (err instanceof ExitCalled) {
            exitCode = err.code
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

export const SCHEMAS_REQUIRES_NEEDED_MARKER: string = `module.exports = {
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

export const SCHEMAS_TWO_RULES: string = `module.exports = {
    "my-kind": {
        validate(rawBody) {
            const errors = []
            if (!rawBody.includes("Needed marker")) {
                errors.push({
                    ruleId: "body.missing_needed_marker",
                    message: "missing marker",
                    severity: "error",
                })
            }
            if (!rawBody.includes("Required tag")) {
                errors.push({
                    ruleId: "body.missing_required_tag",
                    message: "missing required tag",
                    severity: "error",
                })
            }
            return errors
        }
    }
}
`

export const FOLDER_NOTE_BODY: string = '# Work\n\n## Type: my-kind\n\nfolder note body\n'

export async function setupGatedVault(
    schemaPlugin: string = SCHEMAS_REQUIRES_NEEDED_MARKER,
): Promise<string> {
    const vaultRoot: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-batch-')))
    await mkdir(join(vaultRoot, '.voicetree'), {recursive: true})
    await writeFile(join(vaultRoot, '.voicetree', 'schemas.cjs'), schemaPlugin, 'utf8')
    const workDir: string = join(vaultRoot, 'work')
    await mkdir(workDir, {recursive: true})
    await writeFile(join(workDir, 'work.md'), FOLDER_NOTE_BODY, 'utf8')
    clearLoadSchemaPluginCacheForTest()
    return vaultRoot
}

export function mockMcpFetchResponse(toolResult: unknown): typeof globalThis.fetch {
    return ((async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {content: [{type: 'text', text: JSON.stringify(toolResult)}]},
        }),
    })) as unknown) as typeof globalThis.fetch
}
