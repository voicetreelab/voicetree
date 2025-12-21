// OTLP metrics parser - extracts Claude Code metrics from OTLP payloads

import {
  OTLPMetricsRequest,
  ParsedMetrics,
  KeyValue,
  AnyValue,
  NumberDataPoint,
} from './types';

/**
 * Extract string value from OTLP AnyValue
 */
function getStringValue(value: AnyValue | undefined): string | undefined {
  if (!value) return undefined;
  return value.stringValue;
}

/**
 * Extract numeric value from OTLP AnyValue
 */
function getNumericValue(value: AnyValue | undefined): number {
  if (!value) return 0;
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.intValue !== undefined) {
    return typeof value.intValue === 'string'
      ? parseInt(value.intValue, 10)
      : value.intValue;
  }
  return 0;
}

/**
 * Extract numeric value from NumberDataPoint
 */
function getDataPointValue(dataPoint: NumberDataPoint): number {
  if (dataPoint.asDouble !== undefined) return dataPoint.asDouble;
  if (dataPoint.asInt !== undefined) {
    return typeof dataPoint.asInt === 'string'
      ? parseInt(dataPoint.asInt, 10)
      : dataPoint.asInt;
  }
  return 0;
}

/**
 * Find attribute value by key in an array of KeyValue pairs
 */
function findAttribute(
  attributes: KeyValue[] | undefined,
  key: string
): AnyValue | undefined {
  if (!attributes) return undefined;
  const attr = attributes.find((kv) => kv.key === key);
  return attr?.value;
}

/**
 * Parse OTLP metrics request and extract Claude Code metrics
 */
export function parseOTLPMetrics(request: OTLPMetricsRequest): ParsedMetrics {
  let sessionId = 'unknown';
  const tokens = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  let costUsd = 0;

  // Extract session ID from resource attributes
  if (request.resourceMetrics && request.resourceMetrics.length > 0) {
    const resource = request.resourceMetrics[0].resource;
    if (resource?.attributes) {
      const sessionIdAttr = findAttribute(
        resource.attributes,
        'VOICETREE_SESSION_ID'
      );
      if (sessionIdAttr) {
        sessionId = getStringValue(sessionIdAttr) || sessionId;
      }
    }
  }

  // Extract metrics
  for (const resourceMetric of request.resourceMetrics || []) {
    for (const scopeMetric of resourceMetric.scopeMetrics || []) {
      for (const metric of scopeMetric.metrics || []) {
        const metricName = metric.name;

        if (metricName === 'claude_code.token.usage') {
          // Extract token usage metrics
          const dataPoints = metric.sum?.dataPoints || metric.gauge?.dataPoints || [];

          for (const dataPoint of dataPoints) {
            const tokenType = getStringValue(
              findAttribute(dataPoint.attributes, 'token_type')
            );
            const value = getDataPointValue(dataPoint);

            switch (tokenType) {
              case 'input':
                tokens.input += value;
                break;
              case 'output':
                tokens.output += value;
                break;
              case 'cache_read':
                tokens.cacheRead = (tokens.cacheRead || 0) + value;
                break;
              case 'cache_write':
                tokens.cacheWrite = (tokens.cacheWrite || 0) + value;
                break;
            }
          }
        } else if (metricName === 'claude_code.cost.usage') {
          // Extract cost metrics
          const dataPoints = metric.sum?.dataPoints || metric.gauge?.dataPoints || [];

          for (const dataPoint of dataPoints) {
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
