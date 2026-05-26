#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

const DEFAULT_TEMPO_URL = 'http://localhost:2997'
const DEFAULT_PYROSCOPE_URL = 'http://localhost:2995'
const DEFAULT_PROFILE_TYPE = 'wall:cpu:nanoseconds:wall:nanoseconds'
const DEFAULT_PADDING_MS = 60_000

const usage = () => `Usage:
  npm run perf:profile-for-trace -- --trace-id=<hex> [--span-id=<hex>] [--span-name=<name>] [--padding-ms=60000] [--format=text|json]

Environment:
  TEMPO_URL defaults to ${DEFAULT_TEMPO_URL}
  PYROSCOPE_URL defaults to ${DEFAULT_PYROSCOPE_URL}`

export function parseArgs(argv, env = process.env) {
  const config = {
    tempoUrl: env.TEMPO_URL || DEFAULT_TEMPO_URL,
    pyroscopeUrl: env.PYROSCOPE_URL || DEFAULT_PYROSCOPE_URL,
    profileType: DEFAULT_PROFILE_TYPE,
    paddingMs: DEFAULT_PADDING_MS,
    format: 'text',
    traceId: undefined,
    spanId: undefined,
    spanName: undefined,
    help: false,
  }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { ...config, help: true }
    if (arg.startsWith('--trace-id=')) config.traceId = arg.slice('--trace-id='.length)
    else if (arg.startsWith('--span-id=')) config.spanId = arg.slice('--span-id='.length)
    else if (arg.startsWith('--span-name=')) config.spanName = arg.slice('--span-name='.length)
    else if (arg.startsWith('--padding-ms=')) config.paddingMs = Number(arg.slice('--padding-ms='.length))
    else if (arg.startsWith('--profile-type=')) config.profileType = arg.slice('--profile-type='.length)
    else if (arg.startsWith('--format=')) config.format = arg.slice('--format='.length)
    else throw new Error(`unknown option: ${arg}`)
  }

  if (!config.help && !config.traceId) throw new Error('--trace-id is required')
  if (!Number.isSafeInteger(config.paddingMs) || config.paddingMs < 0) {
    throw new Error('--padding-ms must be a non-negative integer')
  }
  if (!['text', 'json'].includes(config.format)) throw new Error('--format must be text or json')
  return config
}

function readOtelValue(value) {
  if (!value || typeof value !== 'object') return undefined
  if ('stringValue' in value) return value.stringValue
  if ('intValue' in value) return Number(value.intValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('boolValue' in value) return Boolean(value.boolValue)
  return undefined
}

function attrsToObject(attributes = []) {
  return Object.fromEntries(attributes.map(({ key, value }) => [key, readOtelValue(value)]))
}

function base64ToHex(value) {
  return value ? Buffer.from(value, 'base64').toString('hex') : ''
}

function nsStringToMs(value) {
  if (value === undefined || value === null || value === '') return 0
  return Number(BigInt(value) / 1_000_000n)
}

function nsStringDeltaMs(start, end) {
  if (!start || !end) return 0
  return Number((BigInt(end) - BigInt(start)) / 1_000_000n)
}

export function flattenTrace(payload) {
  const resourceSpans = payload?.trace?.resourceSpans || payload?.resourceSpans || payload?.batches || []
  return resourceSpans.flatMap((resourceSpan) => {
    const resourceAttrs = attrsToObject(resourceSpan.resource?.attributes)
    return (resourceSpan.scopeSpans || []).flatMap((scopeSpan) => (
      (scopeSpan.spans || []).map((span) => {
        const startMs = nsStringToMs(span.startTimeUnixNano)
        const endMs = nsStringToMs(span.endTimeUnixNano)
        return {
          traceId: base64ToHex(span.traceId),
          spanId: base64ToHex(span.spanId),
          parentSpanId: base64ToHex(span.parentSpanId),
          name: span.name || '<unnamed>',
          startMs,
          endMs,
          durationMs: nsStringDeltaMs(span.startTimeUnixNano, span.endTimeUnixNano),
          serviceName: resourceAttrs['service.name'],
          serviceInstanceId: resourceAttrs['service.instance.id'],
          resourceAttrs,
          spanAttrs: attrsToObject(span.attributes),
        }
      })
    ))
  })
}

export function selectSpan(spans, { spanId, spanName } = {}) {
  if (spans.length === 0) throw new Error('trace has no spans')
  if (spanId) {
    const span = spans.find((candidate) => candidate.spanId === spanId)
    if (!span) throw new Error(`trace has no span_id=${spanId}`)
    return span
  }
  if (spanName) {
    const span = spans.find((candidate) => candidate.name === spanName)
    if (!span) throw new Error(`trace has no span_name=${spanName}`)
    return span
  }
  return [...spans].sort((left, right) => right.durationMs - left.durationMs)[0]
}

function escapeLabelValue(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

export function labelSelectorForSpan(span) {
  if (!span.serviceName) throw new Error('selected span has no resource service.name')
  const labels = [
    ['service_name', span.serviceName],
    span.serviceInstanceId ? ['service_instance_id', span.serviceInstanceId] : undefined,
  ].filter(Boolean)
  return `{${labels.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',')}}`
}

export function profileWindowForSpan(span, paddingMs = DEFAULT_PADDING_MS) {
  return {
    fromMs: Math.max(0, span.startMs - paddingMs),
    untilMs: span.endMs + paddingMs,
  }
}

export function buildPyroscopeRenderUrl({ pyroscopeUrl, profileType, labelSelector, fromMs, untilMs }) {
  const url = new URL('/pyroscope/render', pyroscopeUrl)
  url.searchParams.set('query', `${profileType}${labelSelector}`)
  url.searchParams.set('from', String(Math.floor(fromMs / 1_000)))
  url.searchParams.set('until', String(Math.ceil(untilMs / 1_000)))
  url.searchParams.set('format', 'json')
  return url
}

export function countTimelineSamples(payload) {
  const samples = payload?.timeline?.samples
  if (!Array.isArray(samples)) return 0
  return samples.reduce((sum, sample) => sum + (Number.isFinite(sample) ? sample : 0), 0)
}

export function deriveProfileQuery(tracePayload, config) {
  const spans = flattenTrace(tracePayload)
  const span = selectSpan(spans, config)
  const labelSelector = labelSelectorForSpan(span)
  const window = profileWindowForSpan(span, config.paddingMs)
  const query = `${config.profileType}${labelSelector}`
  const renderUrl = buildPyroscopeRenderUrl({
    pyroscopeUrl: config.pyroscopeUrl,
    profileType: config.profileType,
    labelSelector,
    ...window,
  })
  return {
    trace_id: config.traceId,
    selected_span: {
      span_id: span.spanId,
      name: span.name,
      duration_ms: span.durationMs,
      service_name: span.serviceName,
      service_instance_id: span.serviceInstanceId,
    },
    profile_query: query,
    profile_window: {
      from_ms: window.fromMs,
      until_ms: window.untilMs,
      padding_ms: config.paddingMs,
    },
    pyroscope_render_url: renderUrl.toString(),
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  const text = await response.text()
  if (!response.ok) throw new Error(`${url} failed ${response.status}: ${text.trim()}`)
  return text.length > 0 ? JSON.parse(text) : {}
}

async function tracePayloadFor(config) {
  const url = new URL(`/api/v2/traces/${config.traceId}`, config.tempoUrl)
  const payload = await fetchJson(url)
  if (!payload?.trace || Object.keys(payload.trace).length === 0) {
    throw new Error(`Tempo returned no trace for ${config.traceId}`)
  }
  return payload
}

export async function runProfileCorrelation(config) {
  const tracePayload = await tracePayloadFor(config)
  const derived = deriveProfileQuery(tracePayload, config)
  const pyroscopePayload = await fetchJson(derived.pyroscope_render_url)
  return {
    ...derived,
    samples: countTimelineSamples(pyroscopePayload),
  }
}

function renderText(result) {
  return [
    `trace_id=${result.trace_id}`,
    `span_id=${result.selected_span.span_id}`,
    `span_name=${result.selected_span.name}`,
    `span_duration_ms=${result.selected_span.duration_ms}`,
    `service_name=${result.selected_span.service_name}`,
    `service_instance_id=${result.selected_span.service_instance_id ?? ''}`,
    `profile_query=${result.profile_query}`,
    `profile_window_from_ms=${result.profile_window.from_ms}`,
    `profile_window_until_ms=${result.profile_window.until_ms}`,
    `pyroscope_render_url=${result.pyroscope_render_url}`,
    `samples=${result.samples}`,
    `ok=${result.samples > 0}`,
  ].join('\n')
}

const main = async () => {
  const config = parseArgs(process.argv.slice(2))
  if (config.help) {
    console.log(usage())
    return
  }
  const result = await runProfileCorrelation(config)
  console.log(config.format === 'json' ? JSON.stringify(result, null, 2) : renderText(result))
  if (result.samples <= 0) process.exitCode = 1
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(usage())
    process.exit(1)
  })
}
