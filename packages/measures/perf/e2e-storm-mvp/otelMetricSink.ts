import { metrics, type Meter } from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { ATTR_SERVICE_INSTANCE_ID, ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

const DEFAULT_EXPORT_INTERVAL_MS = 1_000

export interface OtelMetricSink {
    readonly meter: Meter
    readonly forceFlush: () => Promise<void>
    readonly shutdown: () => Promise<void>
}

export function createOtelMetricSink(args: {
    readonly serviceName: string
    readonly meterName: string
    readonly otlpEndpoint?: string
    readonly instanceId?: string
    readonly exportIntervalMs?: number
}): OtelMetricSink {
    if (!args.otlpEndpoint || args.otlpEndpoint.length === 0) {
        return {
            meter: metrics.getMeter(args.meterName),
            forceFlush: () => Promise.resolve(),
            shutdown: () => Promise.resolve(),
        }
    }

    const exporter = new OTLPMetricExporter({ url: args.otlpEndpoint })
    const reader = new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: args.exportIntervalMs ?? DEFAULT_EXPORT_INTERVAL_MS,
    })
    const resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: args.serviceName,
        [ATTR_SERVICE_INSTANCE_ID]:
            args.instanceId && args.instanceId.length > 0 ? args.instanceId : args.serviceName,
    })
    const provider = new MeterProvider({ resource, readers: [reader] })

    return {
        meter: provider.getMeter(args.meterName),
        forceFlush: () => provider.forceFlush(),
        shutdown: () => provider.shutdown(),
    }
}
