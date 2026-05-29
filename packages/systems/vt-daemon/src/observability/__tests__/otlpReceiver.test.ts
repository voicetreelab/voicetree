// BF-382 — black-box behaviour of the daemon's OTLP HTTP receiver. No
// internal mocks: real `http.createServer` listening on localhost, real
// fetch issuing real POSTs, real tmpdir project, real
// `<project>/.voicetree/agent_metrics.json` and `<project>/.voicetree/otlp.port`.

import {readFile, mkdir, mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {getSessions, type SessionMetric} from '../agentMetricsStore.ts'
import {
    OTLP_BASE_PORT,
    startOtlpReceiver,
    stopOtlpReceiver,
    __peekRunningOtlpPortForTests,
} from '../otlpReceiver.ts'
import {otlpPortFilePath, readOtlpPortFile} from '../../lifecycle/otlpPortFile.ts'

interface Harness {
    readonly project: string
    readonly port: number
    readonly url: string
}

function buildFixtureOtlpRequest(sessionId: string): unknown {
    // Mirrors the Claude-Code wire shape — token usage as a Sum metric with
    // type attribute, cost.usage as a single dataPoint.
    return {
        resourceMetrics: [
            {
                resource: {attributes: []},
                scopeMetrics: [
                    {
                        metrics: [
                            {
                                name: 'claude_code.token.usage',
                                sum: {
                                    dataPoints: [
                                        {
                                            attributes: [
                                                {key: 'session.id', value: {stringValue: sessionId}},
                                                {key: 'type', value: {stringValue: 'input'}},
                                            ],
                                            asInt: '120',
                                        },
                                        {
                                            attributes: [
                                                {key: 'session.id', value: {stringValue: sessionId}},
                                                {key: 'type', value: {stringValue: 'output'}},
                                            ],
                                            asInt: '240',
                                        },
                                        {
                                            attributes: [
                                                {key: 'session.id', value: {stringValue: sessionId}},
                                                {key: 'type', value: {stringValue: 'cacheRead'}},
                                            ],
                                            asInt: '60',
                                        },
                                    ],
                                },
                            },
                            {
                                name: 'claude_code.cost.usage',
                                sum: {
                                    dataPoints: [
                                        {
                                            attributes: [
                                                {key: 'session.id', value: {stringValue: sessionId}},
                                            ],
                                            asDouble: 0.0042,
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    }
}

async function startHarness(): Promise<Harness> {
    const root: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-otlpreceiver-')))
    const project: string = join(root, 'project')
    await mkdir(project, {recursive: true})
    await startOtlpReceiver(project)
    const port: number | null = __peekRunningOtlpPortForTests()
    if (port === null) {
        throw new Error('startOtlpReceiver did not record a bound port')
    }
    return {project, port, url: `http://localhost:${port}/v1/metrics`}
}

describe('otlpReceiver', (): void => {
    let h: Harness | null = null

    beforeEach(async (): Promise<void> => {
        h = await startHarness()
    })

    afterEach(async (): Promise<void> => {
        await stopOtlpReceiver()
        if (h !== null) {
            await rm(h.project, {recursive: true, force: true}).catch((): void => {})
        }
        h = null
    })

    it('binds in the 4318–4327 window and publishes <project>/.voicetree/otlp.port', async (): Promise<void> => {
        const harness: Harness = h!
        expect(harness.port).toBeGreaterThanOrEqual(OTLP_BASE_PORT)
        expect(harness.port).toBeLessThan(OTLP_BASE_PORT + 10)

        const published: number | null = await readOtlpPortFile(harness.project)
        expect(published).toBe(harness.port)
    })

    it('POST /v1/metrics with a fixture payload appends to <project>/.voicetree/agent_metrics.json', async (): Promise<void> => {
        const harness: Harness = h!
        const response: Response = await fetch(harness.url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(buildFixtureOtlpRequest('session-xyz')),
        })
        expect(response.status).toBe(200)
        const body: {status: string; metrics: {sessionId: string; costUsd: number}} =
            (await response.json()) as {status: string; metrics: {sessionId: string; costUsd: number}}
        expect(body.status).toBe('success')
        expect(body.metrics.sessionId).toBe('session-xyz')
        expect(body.metrics.costUsd).toBeCloseTo(0.0042, 6)

        const sessions: readonly SessionMetric[] = await getSessions(harness.project)
        expect(sessions).toHaveLength(1)
        expect(sessions[0].sessionId).toBe('session-xyz')
        expect(sessions[0].tokens).toEqual({input: 120, output: 240, cacheRead: 60})
        expect(sessions[0].costUsd).toBeCloseTo(0.0042, 6)
    })

    it('non-POST and wrong-path requests return 404', async (): Promise<void> => {
        const harness: Harness = h!
        const wrongMethod: Response = await fetch(harness.url, {method: 'GET'})
        expect(wrongMethod.status).toBe(404)

        const wrongPath: Response = await fetch(`http://localhost:${harness.port}/anything`, {
            method: 'POST',
            body: '{}',
        })
        expect(wrongPath.status).toBe(404)
    })

    it('rejects payloads larger than 64 KiB with HTTP 413', async (): Promise<void> => {
        const harness: Harness = h!
        // Build a payload that exceeds 64 KiB once stringified — a single
        // long pad string in a benign field, well over the cap.
        const padded: unknown = {
            resourceMetrics: [],
            // 70 KiB of padding so the streamed body crosses the cap.
            pad: 'x'.repeat(70 * 1024),
        }
        const response: Response = await fetch(harness.url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(padded),
        })
        expect(response.status).toBe(413)
    })

    it('stopOtlpReceiver removes the otlp.port discovery file', async (): Promise<void> => {
        const harness: Harness = h!
        const filePath: string = otlpPortFilePath(harness.project)
        await readFile(filePath, 'utf8') // would throw if missing
        await stopOtlpReceiver()
        await expect(readFile(filePath, 'utf8')).rejects.toThrow()

        // restart for the afterEach to find h still set
        await startOtlpReceiver(harness.project)
    })

    it('starting a second receiver while one is already running throws (no double-bind)', async (): Promise<void> => {
        const harness: Harness = h!
        await expect(startOtlpReceiver(harness.project)).rejects.toThrow(/already running/)
    })
})
