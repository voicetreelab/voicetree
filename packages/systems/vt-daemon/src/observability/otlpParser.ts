// BF-382 · Phase 3 — pure OTLP metrics parser.
//
// Relocated verbatim from `webapp/.../otlp-parser.ts` (Main-side, pre-Phase-3)
// to the daemon. Pure: no I/O, no Node-only globals, no state. Maps a raw
// OTLP metrics request (the Claude-Code wire shape on POST /v1/metrics) to a
// flat `ParsedMetrics` record carrying the session id, per-type token counts,
// and the USD cost roll-up.
//
// Recognized OTLP metrics:
//   - `claude_code.token.usage` — dataPoint.attributes.type ∈
//     { 'input', 'output', 'cacheRead', 'cacheCreation' }; sums by type.
//   - `claude_code.cost.usage`  — sums into `costUsd`.
// Session id is read from `dataPoint.attributes['session.id']` on the first
// dataPoint that carries it (per Claude Code's emitter contract).
//
// Function shape is per CLAUDE.md: pure, narrow, deep. The caller (the OTLP
// HTTP handler) owns the impurity (request reading, parsing JSON envelope,
// persistence).

import type {TokenMetrics} from './agentMetricsStore.ts'

// OTLP Protocol types (subset required for Claude Code's metrics emitter).
interface AnyValue {
    stringValue?: string
    intValue?: string | number
    doubleValue?: number
    boolValue?: boolean
}

interface KeyValue {
    key?: string
    value?: AnyValue
}

interface NumberDataPoint {
    attributes?: KeyValue[]
    asDouble?: number
    asInt?: string | number
}

interface Sum {
    dataPoints?: NumberDataPoint[]
}

interface Gauge {
    dataPoints?: NumberDataPoint[]
}

interface Metric {
    name?: string
    sum?: Sum
    gauge?: Gauge
}

interface ScopeMetrics {
    metrics?: Metric[]
}

interface Resource {
    attributes?: KeyValue[]
}

interface ResourceMetrics {
    resource?: Resource
    scopeMetrics?: ScopeMetrics[]
}

export interface OTLPMetricsRequest {
    resourceMetrics?: ResourceMetrics[]
}

export interface ParsedMetrics {
    readonly sessionId: string
    readonly tokens: TokenMetrics & {cacheWrite?: number}
    readonly costUsd: number
}

function getStringValue(value: AnyValue | undefined): string | undefined {
    if (!value) return undefined
    return value.stringValue
}

function getDataPointValue(dataPoint: NumberDataPoint): number {
    if (dataPoint.asDouble !== undefined) return dataPoint.asDouble
    if (dataPoint.asInt !== undefined) {
        return typeof dataPoint.asInt === 'string'
            ? Number.parseInt(dataPoint.asInt, 10)
            : dataPoint.asInt
    }
    return 0
}

function findAttribute(
    attributes: KeyValue[] | undefined,
    key: string,
): AnyValue | undefined {
    if (!attributes) return undefined
    const attr: KeyValue | undefined = attributes.find((kv: KeyValue) => kv.key === key)
    return attr?.value
}

export function parseOTLPMetrics(request: OTLPMetricsRequest): ParsedMetrics {
    let sessionId: string = 'unknown'
    const tokens: {input: number; output: number; cacheRead: number; cacheWrite: number} = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    }
    let costUsd: number = 0

    for (const resourceMetric of request.resourceMetrics ?? []) {
        for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
            for (const metric of scopeMetric.metrics ?? []) {
                const metricName: string | undefined = metric.name

                if (metricName === 'claude_code.token.usage') {
                    const dataPoints: NumberDataPoint[] = metric.sum?.dataPoints
                        ?? metric.gauge?.dataPoints
                        ?? []

                    for (const dataPoint of dataPoints) {
                        if (sessionId === 'unknown') {
                            const sessionIdAttr: AnyValue | undefined = findAttribute(
                                dataPoint.attributes,
                                'session.id',
                            )
                            if (sessionIdAttr) {
                                sessionId = getStringValue(sessionIdAttr) ?? sessionId
                            }
                        }

                        const tokenType: string | undefined = getStringValue(
                            findAttribute(dataPoint.attributes, 'type'),
                        )
                        const value: number = getDataPointValue(dataPoint)

                        switch (tokenType) {
                            case 'input':
                                tokens.input += value
                                break
                            case 'output':
                                tokens.output += value
                                break
                            case 'cacheRead':
                                tokens.cacheRead = (tokens.cacheRead || 0) + value
                                break
                            case 'cacheCreation':
                                tokens.cacheWrite = (tokens.cacheWrite || 0) + value
                                break
                        }
                    }
                } else if (metricName === 'claude_code.cost.usage') {
                    const dataPoints: NumberDataPoint[] = metric.sum?.dataPoints
                        ?? metric.gauge?.dataPoints
                        ?? []

                    for (const dataPoint of dataPoints) {
                        if (sessionId === 'unknown') {
                            const sessionIdAttr: AnyValue | undefined = findAttribute(
                                dataPoint.attributes,
                                'session.id',
                            )
                            if (sessionIdAttr) {
                                sessionId = getStringValue(sessionIdAttr) ?? sessionId
                            }
                        }
                        costUsd += getDataPointValue(dataPoint)
                    }
                }
            }
        }
    }

    return {
        sessionId,
        tokens,
        costUsd,
    }
}
