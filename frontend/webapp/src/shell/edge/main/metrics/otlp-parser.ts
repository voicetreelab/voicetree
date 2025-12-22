// OTLP metrics parser - extracts Claude Code metrics from OTLP payloads
// Ported from tools/otlp-receiver/src/parser.ts

import type { TokenMetrics } from './agent-metrics-store';

// OTLP Protocol types (simplified for our use case)
interface AnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}

interface KeyValue {
  key?: string;
  value?: AnyValue;
}

interface NumberDataPoint {
  attributes?: KeyValue[];
  asDouble?: number;
  asInt?: string | number;
}

interface Sum {
  dataPoints?: NumberDataPoint[];
}

interface Gauge {
  dataPoints?: NumberDataPoint[];
}

interface Metric {
  name?: string;
  sum?: Sum;
  gauge?: Gauge;
}

interface ScopeMetrics {
  metrics?: Metric[];
}

interface Resource {
  attributes?: KeyValue[];
}

interface ResourceMetrics {
  resource?: Resource;
  scopeMetrics?: ScopeMetrics[];
}

export interface OTLPMetricsRequest {
  resourceMetrics?: ResourceMetrics[];
}

export interface ParsedMetrics {
  sessionId: string;
  tokens: TokenMetrics & { cacheWrite?: number };
  costUsd: number;
}

function getStringValue(value: AnyValue | undefined): string | undefined {
  if (!value) return undefined;
  return value.stringValue;
}

function getDataPointValue(dataPoint: NumberDataPoint): number {
  if (dataPoint.asDouble !== undefined) return dataPoint.asDouble;
  if (dataPoint.asInt !== undefined) {
    return typeof dataPoint.asInt === 'string'
      ? parseInt(dataPoint.asInt, 10)
      : dataPoint.asInt;
  }
  return 0;
}

function findAttribute(
  attributes: KeyValue[] | undefined,
  key: string
): AnyValue | undefined {
  if (!attributes) return undefined;
  const attr = attributes.find((kv) => kv.key === key);
  return attr?.value;
}

export function parseOTLPMetrics(request: OTLPMetricsRequest): ParsedMetrics {
  let sessionId = 'unknown';
  const tokens = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  let costUsd = 0;

  // Extract metrics (session ID comes from dataPoint attributes, not resource)
  for (const resourceMetric of request.resourceMetrics || []) {
    for (const scopeMetric of resourceMetric.scopeMetrics || []) {
      for (const metric of scopeMetric.metrics || []) {
        const metricName = metric.name;

        if (metricName === 'claude_code.token.usage') {
          const dataPoints = metric.sum?.dataPoints || metric.gauge?.dataPoints || [];

          for (const dataPoint of dataPoints) {
            // Extract session ID from dataPoint attributes (Claude sends 'session.id')
            if (sessionId === 'unknown') {
              const sessionIdAttr = findAttribute(dataPoint.attributes, 'session.id');
              if (sessionIdAttr) {
                sessionId = getStringValue(sessionIdAttr) || sessionId;
              }
            }

            // Claude sends 'type' attribute, not 'token_type'
            const tokenType = getStringValue(
              findAttribute(dataPoint.attributes, 'type')
            );
            const value = getDataPointValue(dataPoint);

            // Claude sends 'cacheRead' and 'cacheCreation', not 'cache_read' / 'cache_write'
            switch (tokenType) {
              case 'input':
                tokens.input += value;
                break;
              case 'output':
                tokens.output += value;
                break;
              case 'cacheRead':
                tokens.cacheRead = (tokens.cacheRead || 0) + value;
                break;
              case 'cacheCreation':
                tokens.cacheWrite = (tokens.cacheWrite || 0) + value;
                break;
            }
          }
        } else if (metricName === 'claude_code.cost.usage') {
          const dataPoints = metric.sum?.dataPoints || metric.gauge?.dataPoints || [];

          for (const dataPoint of dataPoints) {
            // Also extract session ID from cost metrics if not found yet
            if (sessionId === 'unknown') {
              const sessionIdAttr = findAttribute(dataPoint.attributes, 'session.id');
              if (sessionIdAttr) {
                sessionId = getStringValue(sessionIdAttr) || sessionId;
              }
            }
            costUsd += getDataPointValue(dataPoint);
          }
        }
      }
    }
  }

  return {
    sessionId,
    tokens,
    costUsd,
  };
}
