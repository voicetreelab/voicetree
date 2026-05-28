// BF-382 — pure-parser coverage for the relocated `parseOTLPMetrics`.
// Pure: no I/O, fixtures-in / records-out. Same wire fixtures the legacy
// Main-side `otlp-parser.test.ts` exercised (now deleted with the file
// move), plus regression cases for edge attributes Claude-Code emits.

import {describe, expect, it} from 'vitest'

import {
    parseOTLPMetrics,
    type OTLPMetricsRequest,
    type ParsedMetrics,
} from '../otlpParser.ts'

// Real OTLP payload fixture captured from Claude Code.
const REAL_OTLP_PAYLOAD: OTLPMetricsRequest = {
    resourceMetrics: [
        {
            resource: {
                attributes: [
                    {key: 'service.name', value: {stringValue: 'claude-code'}},
                    {key: 'service.version', value: {stringValue: '2.0.75'}},
                ],
            },
            scopeMetrics: [
                {
                    metrics: [
                        {
                            name: 'claude_code.cost.usage',
                            sum: {
                                dataPoints: [
                                    {
                                        attributes: [
                                            {key: 'session.id', value: {stringValue: 'a602fe87-9207-4d27-a32a-c691ea7453d5'}},
                                            {key: 'model', value: {stringValue: 'claude-opus-4-5-20251101'}},
                                        ],
                                        asDouble: 0.0234,
                                    },
                                ],
                            },
                        },
                        {
                            name: 'claude_code.token.usage',
                            sum: {
                                dataPoints: [
                                    {
                                        attributes: [
                                            {key: 'session.id', value: {stringValue: 'a602fe87-9207-4d27-a32a-c691ea7453d5'}},
                                            {key: 'type', value: {stringValue: 'input'}},
                                        ],
                                        asInt: 1500,
                                    },
                                    {
                                        attributes: [
                                            {key: 'session.id', value: {stringValue: 'a602fe87-9207-4d27-a32a-c691ea7453d5'}},
                                            {key: 'type', value: {stringValue: 'output'}},
                                        ],
                                        asInt: 800,
                                    },
                                    {
                                        attributes: [
                                            {key: 'session.id', value: {stringValue: 'a602fe87-9207-4d27-a32a-c691ea7453d5'}},
                                            {key: 'type', value: {stringValue: 'cacheRead'}},
                                        ],
                                        asInt: 500,
                                    },
                                    {
                                        attributes: [
                                            {key: 'session.id', value: {stringValue: 'a602fe87-9207-4d27-a32a-c691ea7453d5'}},
                                            {key: 'type', value: {stringValue: 'cacheCreation'}},
                                        ],
                                        asInt: 200,
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

describe('parseOTLPMetrics', (): void => {
    it('extracts session ID from dataPoint attributes', (): void => {
        const result: ParsedMetrics = parseOTLPMetrics(REAL_OTLP_PAYLOAD)
        expect(result.sessionId).toBe('a602fe87-9207-4d27-a32a-c691ea7453d5')
    })

    it('extracts cost in USD', (): void => {
        const result: ParsedMetrics = parseOTLPMetrics(REAL_OTLP_PAYLOAD)
        expect(result.costUsd).toBeCloseTo(0.0234, 6)
    })

    it('extracts input / output / cacheRead / cacheCreation tokens by type attribute', (): void => {
        const result: ParsedMetrics = parseOTLPMetrics(REAL_OTLP_PAYLOAD)
        expect(result.tokens.input).toBe(1500)
        expect(result.tokens.output).toBe(800)
        expect(result.tokens.cacheRead).toBe(500)
        expect(result.tokens.cacheWrite).toBe(200)
    })

    it('handles an empty request gracefully', (): void => {
        const result: ParsedMetrics = parseOTLPMetrics({})
        expect(result.sessionId).toBe('unknown')
        expect(result.costUsd).toBe(0)
        expect(result.tokens.input).toBe(0)
        expect(result.tokens.output).toBe(0)
    })

    it('handles a payload with no metrics array', (): void => {
        const payload: OTLPMetricsRequest = {
            resourceMetrics: [{resource: {attributes: []}, scopeMetrics: [{metrics: []}]}],
        }
        const result: ParsedMetrics = parseOTLPMetrics(payload)
        expect(result.sessionId).toBe('unknown')
        expect(result.costUsd).toBe(0)
    })

    it('aggregates multiple token dataPoints of same type', (): void => {
        const payload: OTLPMetricsRequest = {
            resourceMetrics: [
                {
                    scopeMetrics: [
                        {
                            metrics: [
                                {
                                    name: 'claude_code.token.usage',
                                    sum: {
                                        dataPoints: [
                                            {
                                                attributes: [
                                                    {key: 'session.id', value: {stringValue: 'session-1'}},
                                                    {key: 'type', value: {stringValue: 'input'}},
                                                ],
                                                asInt: 100,
                                            },
                                            {
                                                attributes: [
                                                    {key: 'session.id', value: {stringValue: 'session-1'}},
                                                    {key: 'type', value: {stringValue: 'input'}},
                                                ],
                                                asInt: 150,
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
        const result: ParsedMetrics = parseOTLPMetrics(payload)
        expect(result.tokens.input).toBe(250)
    })

    it('parses asInt when serialized as a string (OTLP wire quirk)', (): void => {
        const payload: OTLPMetricsRequest = {
            resourceMetrics: [
                {
                    scopeMetrics: [
                        {
                            metrics: [
                                {
                                    name: 'claude_code.token.usage',
                                    sum: {
                                        dataPoints: [
                                            {
                                                attributes: [
                                                    {key: 'session.id', value: {stringValue: 'session-1'}},
                                                    {key: 'type', value: {stringValue: 'output'}},
                                                ],
                                                asInt: '999',
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
        const result: ParsedMetrics = parseOTLPMetrics(payload)
        expect(result.tokens.output).toBe(999)
    })
})
