import { metrics, type Meter } from '@opentelemetry/api'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { ATTR_SERVICE_INSTANCE_ID, ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

const DEFAULT_EXPORT_INTERVAL_MS = 1_000

// Reader-env: callers pass their env-derived values explicitly rather than
// `init` reading process.env. Mirrors tracing.ts so observability stays
// strict-tier clean on implicit-globals.
type MetricsEnv = {
  readonly otlpEndpoint?: string
  readonly instanceId?: string
  readonly exportIntervalMs?: number
}

// Initialize metrics — call once at process startup.
// When `env.otlpEndpoint` is empty/missing, the global metrics API stays
// no-op (returns inert meters). When set, registers a MeterProvider with
// OTLP gRPC export at `env.exportIntervalMs` (default 1s) and the same
// service.name + service.instance.id resource as tracing.
//
// Idempotency is delegated to OTel's setGlobalMeterProvider (a second call
// overwrites). No module-level guard binding — state-threading via the OTel
// global registry instead.
function initMetricsImpl(serviceName: string, env: MetricsEnv = {}): void {
  if (!env.otlpEndpoint || env.otlpEndpoint.length === 0) {
    return
  }
  const endpoint = env.otlpEndpoint

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_INSTANCE_ID]:
      env.instanceId && env.instanceId.length > 0 ? env.instanceId : serviceName,
  })

  // Metrics export only runs when an OTLP endpoint is configured (dev / perf-stack).
  // Lazy-load the gRPC OTLP exporter (heavy @grpc/protobuf tree) so it stays
  // external (see MAIN_RUNTIME_EXTERNALS) — never bundled into or shipped with the
  // production app, which never sets VOICETREE_OTLP_ENDPOINT.
  void import('@opentelemetry/exporter-metrics-otlp-grpc').then(({ OTLPMetricExporter }) => {
    const exporter = new OTLPMetricExporter({ url: endpoint })
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: env.exportIntervalMs ?? DEFAULT_EXPORT_INTERVAL_MS,
    })
    const provider = new MeterProvider({ resource, readers: [reader] })
    metrics.setGlobalMeterProvider(provider)
  })
}

// Returns a Meter scoped under `name`. Before `initMetrics` is called or
// when no OTLP endpoint is configured, this returns an inert (no-op)
// meter from the OTel API default — callers never need to null-check.
function getMeterImpl(name: string): Meter {
  return metrics.getMeter(name)
}

export const observabilityMetrics = {
  /** Initialize metrics once at process startup. No-op when env.otlpEndpoint is empty. */
  init: initMetricsImpl,
  /** Get a Meter scoped under `name`. Safe to call before init (returns no-op meter). */
  getMeter: getMeterImpl,
} as const
