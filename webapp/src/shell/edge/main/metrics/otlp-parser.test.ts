import { describe, it, expect } from 'vitest';
import { parseOTLPMetrics, type OTLPMetricsRequest, type ParsedMetrics } from './otlp-parser';

// Real OTLP payload fixture captured from Claude Code (Phase 1)
// Key attributes from Claude Code telemetry:
// - session.id in dataPoint.attributes (not resource attributes)
// - type attribute for token types: "input", "output", "cacheRead", "cacheCreation"
const REAL_OTLP_PAYLOAD: OTLPMetricsRequest = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'claude-code' } },
          { key: 'service.version', value: { stringValue: '2.0.75' } },
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
                      { key: 'session.id', value: { stringValue: 'a602fe87-9207-4d27-a32a-c691ea7453d5' } },
                      { key: 'model', value: { stringValue: 'claude-opus-4-5-20251101' } },
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
                      { key: 'session.id', value: { stringValue: 'a602fe87-9207-4d27-a32a-c691ea7453d5' } },
                      { key: 'model', value: { stringValue: 'claude-opus-4-5-20251101' } },
                      { key: 'type', value: { stringValue: 'input' } },
                    ],
                    asInt: 1500,
                  },
                  {
                    attributes: [
                      { key: 'session.id', value: { stringValue: 'a602fe87-9207-4d27-a32a-c691ea7453d5' } },
                      { key: 'model', value: { stringValue: 'claude-opus-4-5-20251101' } },
                      { key: 'type', value: { stringValue: 'output' } },
                    ],
                    asInt: 800,
                  },
                  {
                    attributes: [
                      { key: 'session.id', value: { stringValue: 'a602fe87-9207-4d27-a32a-c691ea7453d5' } },
                      { key: 'model', value: { stringValue: 'claude-opus-4-5-20251101' } },
                      { key: 'type', value: { stringValue: 'cacheRead' } },
                    ],
                    asInt: 500,
                  },
                  {
                    attributes: [
                      { key: 'session.id', value: { stringValue: 'a602fe87-9207-4d27-a32a-c691ea7453d5' } },
                      { key: 'model', value: { stringValue: 'claude-opus-4-5-20251101' } },
                      { key: 'type', value: { stringValue: 'cacheCreation' } },
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
};

describe('parseOTLPMetrics', () => {
  it('extracts session ID from dataPoint attributes', () => {
    const result: ParsedMetrics = parseOTLPMetrics(REAL_OTLP_PAYLOAD);
    expect(result.sessionId).toBe('a602fe87-9207-4d27-a32a-c691ea7453d5');
  });

  it('extracts cost in USD', () => {
    const result: ParsedMetrics = parseOTLPMetrics(REAL_OTLP_PAYLOAD);
    expect(result.costUsd).toBe(0.0234);
  });

  it('extracts input tokens', () => {
    const result: ParsedMetrics = parseOTLPMetrics(REAL_OTLP_PAYLOAD);
    expect(result.tokens.input).toBe(1500);
  });

  it('extracts output tokens', () => {
    const result: ParsedMetrics = parseOTLPMetrics(REAL_OTLP_PAYLOAD);
    expect(result.tokens.output).toBe(800);
  });

  it('extracts cacheRead tokens', () => {
    const result: ParsedMetrics = parseOTLPMetrics(REAL_OTLP_PAYLOAD);
    expect(result.tokens.cacheRead).toBe(500);
  });

  it('extracts cacheWrite (cacheCreation) tokens', () => {
    const result: ParsedMetrics = parseOTLPMetrics(REAL_OTLP_PAYLOAD);
    expect(result.tokens.cacheWrite).toBe(200);
  });

  it('handles empty payload gracefully', () => {
    const result: ParsedMetrics = parseOTLPMetrics({});
    expect(result.sessionId).toBe('unknown');
    expect(result.costUsd).toBe(0);
    expect(result.tokens.input).toBe(0);
    expect(result.tokens.output).toBe(0);
  });

  it('handles payload with no metrics', () => {
    const payload: OTLPMetricsRequest = {
      resourceMetrics: [
        {
          resource: { attributes: [] },
          scopeMetrics: [{ metrics: [] }],
        },
      ],
    };
    const result: ParsedMetrics = parseOTLPMetrics(payload);
    expect(result.sessionId).toBe('unknown');
    expect(result.costUsd).toBe(0);
  });

  it('aggregates multiple token dataPoints of same type', () => {
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
                          { key: 'session.id', value: { stringValue: 'session-1' } },
                          { key: 'type', value: { stringValue: 'input' } },
                        ],
                        asInt: 100,
                      },
                      {
                        attributes: [
                          { key: 'session.id', value: { stringValue: 'session-1' } },
                          { key: 'type', value: { stringValue: 'input' } },
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
    };
    const result: ParsedMetrics = parseOTLPMetrics(payload);
    expect(result.tokens.input).toBe(250);
  });

  it('handles asInt as string (OTLP serialization quirk)', () => {
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
                          { key: 'session.id', value: { stringValue: 'session-1' } },
                          { key: 'type', value: { stringValue: 'output' } },
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
    };
    const result: ParsedMetrics = parseOTLPMetrics(payload);
    expect(result.tokens.output).toBe(999);
  });
});
