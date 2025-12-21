// Types for OTLP metrics parsing and Claude Code metrics extraction

export interface ParsedMetrics {
  sessionId: string;
  tokens: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  costUsd: number;
}

// OTLP Protocol types (simplified for our use case)
export interface OTLPMetricsRequest {
  resourceMetrics?: ResourceMetrics[];
}

export interface ResourceMetrics {
  resource?: Resource;
  scopeMetrics?: ScopeMetrics[];
}

export interface Resource {
  attributes?: KeyValue[];
}

export interface ScopeMetrics {
  scope?: InstrumentationScope;
  metrics?: Metric[];
}

export interface InstrumentationScope {
  name?: string;
  version?: string;
}

export interface Metric {
  name?: string;
  description?: string;
  unit?: string;
  sum?: Sum;
  gauge?: Gauge;
  histogram?: Histogram;
}

export interface Sum {
  dataPoints?: NumberDataPoint[];
  aggregationTemporality?: number;
  isMonotonic?: boolean;
}

export interface Gauge {
  dataPoints?: NumberDataPoint[];
}

export interface Histogram {
  dataPoints?: HistogramDataPoint[];
  aggregationTemporality?: number;
}

export interface NumberDataPoint {
  attributes?: KeyValue[];
  timeUnixNano?: string | number;
  asDouble?: number;
  asInt?: string | number;
}

export interface HistogramDataPoint {
  attributes?: KeyValue[];
  timeUnixNano?: string | number;
  count?: string | number;
  sum?: number;
  bucketCounts?: (string | number)[];
  explicitBounds?: number[];
}

export interface KeyValue {
  key?: string;
  value?: AnyValue;
}

export interface AnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: ArrayValue;
  kvlistValue?: KeyValueList;
}

export interface ArrayValue {
  values?: AnyValue[];
}

export interface KeyValueList {
  values?: KeyValue[];
}

// Callback type for emitting parsed metrics
export type MetricsCallback = (metrics: ParsedMetrics) => void | Promise<void>;
