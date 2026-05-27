import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {mkdir, mkdtemp, realpath, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {vi, type MockInstance} from 'vitest'
import {generateAuthToken, writeAuthTokenFile, writeRpcPortFile} from '@vt/vt-rpc'
import {graphCreate} from '../core/graph'
import {clearLoadSchemaPluginCacheForTest} from '../core/loadSchemaPlugin'
import {CliError} from '../../output'

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

// Spins up a minimal HTTP JSON-RPC responder so daemon-client.ts exercises
// the real wire (HTTP + bearer auth) without importing the vt-daemon
// internals. The CLI package only depends on the daemon's JSON-RPC contract
// (POST /rpc with `Authorization: Bearer <token>`), so a hand-rolled server
// is a faithful black-box stand-in: any drift from the wire contract would
// surface as a `callDaemon` test failure.
export interface StubDaemon {
    readonly vaultPath: string
    readonly url: string
    readonly stop: () => Promise<void>
}

async function readBody(req: IncomingMessage): Promise<string> {
    return new Promise<string>((resolveBody, rejectBody): void => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer): void => {
            chunks.push(chunk)
        })
        req.on('end', (): void => resolveBody(Buffer.concat(chunks).toString('utf8')))
        req.on('error', rejectBody)
    })
}

export async function startStubDaemon(toolResult: unknown): Promise<StubDaemon> {
    const vaultPath: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-http-stub-')))
    await mkdir(join(vaultPath, '.voicetree'), {recursive: true})

    const token: string = generateAuthToken()
    await writeAuthTokenFile(vaultPath, token)

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse): void => {
        void readBody(req).then((raw: string): void => {
            const auth: string | undefined = req.headers.authorization
            if (auth !== `Bearer ${token}`) {
                res.statusCode = 401
                res.end()
                return
            }
            let parsedId: number | string | null = null
            try {
                const payload: unknown = JSON.parse(raw)
                if (payload !== null && typeof payload === 'object' && 'id' in payload) {
                    const candidate: unknown = (payload as {id?: unknown}).id
                    if (typeof candidate === 'number' || typeof candidate === 'string') {
                        parsedId = candidate
                    }
                }
            } catch {
                // Treat as null id; the test path always sends a valid envelope.
            }
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({jsonrpc: '2.0', id: parsedId, result: toolResult}))
        })
    })
    await new Promise<void>((resolveListen): void => {
        server.listen(0, '127.0.0.1', (): void => resolveListen())
    })
    const address = server.address()
    if (typeof address !== 'object' || address === null) {
        throw new Error('startStubDaemon: server.listen did not yield an address')
    }
    const port: number = address.port
    await writeRpcPortFile(vaultPath, port)

    return {
        vaultPath,
        url: `http://127.0.0.1:${port}`,
        stop: (): Promise<void> => new Promise<void>((resolveClose, rejectClose): void => {
            server.closeAllConnections?.()
            server.close((err: Error | undefined): void => (err ? rejectClose(err) : resolveClose()))
        }),
    }
}
