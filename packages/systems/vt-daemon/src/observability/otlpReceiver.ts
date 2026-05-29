// BF-382 · Phase 3 — daemon-side OTLP HTTP receiver.
//
// Relocates the OTLP listener (POST /v1/metrics) from Electron Main into the
// daemon. Identical wire shape as before — Claude-Code-style agents are
// unmodified; only the listening process moves. Both Electron Main and any
// CLI peer reach the same per-project metrics surface via JSON-RPC, while
// agents continue to emit metrics on the discovered port.
//
// Lifecycle: `startOtlpReceiver(project)` binds to localhost on
// `OTLP_BASE_PORT` (4318), retrying up to `OTLP_MAX_PORT_ATTEMPTS` (10)
// times on EADDRINUSE — matching the prior Main-side contract. On a
// successful bind the chosen port is published to
// `<project>/.voicetree/otlp.port` via the atomic writer in
// `../lifecycle/otlpPortFile.ts`. `stopOtlpReceiver()` closes the listener
// and removes the port file.
//
// Body cap: 64 KiB on POST /v1/metrics (BF-382 §Gotcha — the legacy
// Main-side receiver collected chunks unbounded, an OOM hazard for any
// local-process emitter). Mirrors `transport/httpServer.ts`'s 64 KiB cap on
// /rpc and /hook.
//
// Functional design: parsing is delegated to the pure `parseOTLPMetrics`;
// persistence is delegated to `appendTokenMetrics`. This module owns only
// the impure HTTP shell + lifecycle.

import http, {type IncomingMessage, type Server, type ServerResponse} from 'node:http'

import {appendTokenMetrics} from './agentMetricsStore.ts'
import {parseOTLPMetrics, type OTLPMetricsRequest, type ParsedMetrics} from './otlpParser.ts'
import {removeOtlpPortFile, writeOtlpPortFile} from '../lifecycle/otlpPortFile.ts'

export const OTLP_BASE_PORT: number = 4318
export const OTLP_MAX_PORT_ATTEMPTS: number = 10
const OTLP_HOST: string = 'localhost'
const BODY_LIMIT_BYTES: number = 64 * 1024

interface RunningReceiver {
    readonly server: Server
    readonly port: number
    readonly project: string
}

let running: RunningReceiver | null = null

function readBodyWithCap(req: IncomingMessage): Promise<string | {readonly tooLarge: true}> {
    return new Promise<string | {readonly tooLarge: true}>((resolveBody, rejectBody): void => {
        const chunks: Buffer[] = []
        let total: number = 0
        let settled: boolean = false
        req.on('data', (chunk: Buffer): void => {
            if (settled) return
            total += chunk.length
            if (total > BODY_LIMIT_BYTES) {
                settled = true
                resolveBody({tooLarge: true})
                return
            }
            chunks.push(chunk)
        })
        req.on('end', (): void => {
            if (settled) return
            settled = true
            resolveBody(Buffer.concat(chunks).toString('utf8'))
        })
        req.on('error', (cause: Error): void => {
            if (settled) return
            settled = true
            rejectBody(cause)
        })
    })
}

async function handleMetricsRequest(
    req: IncomingMessage,
    res: ServerResponse,
    project: string,
): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/v1/metrics') {
        res.writeHead(404, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({error: 'Not found'}))
        return
    }

    const body: string | {tooLarge: true} = await readBodyWithCap(req)
    if (typeof body !== 'string') {
        res.writeHead(413, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({status: 'error', message: 'Payload too large (>64 KiB)'}))
        return
    }

    try {
        const payload: OTLPMetricsRequest = JSON.parse(body)
        const parsed: ParsedMetrics = parseOTLPMetrics(payload)
        await appendTokenMetrics(
            project,
            parsed.sessionId,
            {
                input: parsed.tokens.input,
                output: parsed.tokens.output,
                cacheRead: parsed.tokens.cacheRead,
            },
            parsed.costUsd,
        )
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({status: 'success', metrics: parsed}))
    } catch (cause) {
        process.stderr.write(
            `[otlpReceiver] Error parsing metrics: ${(cause as Error).message}\n`,
        )
        res.writeHead(400, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({
            status: 'error',
            message: 'Failed to parse OTLP metrics',
        }))
    }
}

function tryListenOnPort(port: number, project: string): Promise<Server | null> {
    return new Promise<Server | null>((resolveTry): void => {
        const candidate: Server = http.createServer((req: IncomingMessage, res: ServerResponse): void => {
            void handleMetricsRequest(req, res, project).catch((cause: unknown): void => {
                process.stderr.write(
                    `[otlpReceiver] handler error: ${(cause as Error).message}\n`,
                )
                if (!res.headersSent) {
                    res.statusCode = 500
                    res.end()
                }
            })
        })
        candidate.once('error', (cause: NodeJS.ErrnoException): void => {
            if (cause.code !== 'EADDRINUSE') {
                process.stderr.write(`[otlpReceiver] listen error on ${port}: ${cause.message}\n`)
            }
            resolveTry(null)
        })
        candidate.listen(port, OTLP_HOST, (): void => {
            candidate.removeAllListeners('error')
            resolveTry(candidate)
        })
    })
}

export async function startOtlpReceiver(project: string): Promise<void> {
    if (running !== null) {
        throw new Error(
            `startOtlpReceiver: receiver already running on port ${running.port} for project ${running.project}. `
            + `Call stopOtlpReceiver() first.`,
        )
    }
    for (let i: number = 0; i < OTLP_MAX_PORT_ATTEMPTS; i++) {
        const port: number = OTLP_BASE_PORT + i
        const bound: Server | null = await tryListenOnPort(port, project)
        if (bound !== null) {
            running = {server: bound, port, project}
            await writeOtlpPortFile(project, port)
            return
        }
    }
    const last: number = OTLP_BASE_PORT + OTLP_MAX_PORT_ATTEMPTS - 1
    throw new Error(
        `startOtlpReceiver: all ports ${OTLP_BASE_PORT}-${last} in use. Cannot bind OTLP listener.`,
    )
}

export async function stopOtlpReceiver(): Promise<void> {
    const current: RunningReceiver | null = running
    if (current === null) return
    running = null
    await new Promise<void>((resolveStop, rejectStop): void => {
        current.server.close((cause?: Error): void => {
            if (cause) rejectStop(cause)
            else resolveStop()
        })
    })
    await removeOtlpPortFile(current.project).catch((cause: unknown): void => {
        process.stderr.write(
            `[otlpReceiver] failed to remove otlp.port: ${(cause as Error).message}\n`,
        )
    })
}

// Test-only inspector — black-box tests use this to discover the chosen
// port without round-tripping through the disk-published `otlp.port` file
// when they want fast assertions. The public `<project>/.voicetree/otlp.port`
// remains the contract for any non-test caller.
export function __peekRunningOtlpPortForTests(): number | null {
    return running?.port ?? null
}
