#!/usr/bin/env node

const DEFAULT_TEMPO_ADDR = 'http://localhost:2997'
const DEFAULT_LIMIT = 20
const DEFAULT_FROM = '24h'

const usage = () => `Usage:
  npm run perf:traceql -- '<traceql>' [--limit=N] [--from=<duration>] [--format=tree|ndjson|json]
  npm run perf:traceql -- --trace-id=<hex> [--format=tree|ndjson|json]
  npm run perf:traceql -- --tags [--format=tree|ndjson|json]

Environment:
  TEMPO_ADDR defaults to ${DEFAULT_TEMPO_ADDR}`

const parseArgs = (argv) => {
  const config = {
    tempoAddr: process.env.TEMPO_ADDR || DEFAULT_TEMPO_ADDR,
    limit: DEFAULT_LIMIT,
    from: DEFAULT_FROM,
    format: 'tree',
    tags: false,
    traceId: undefined,
    query: undefined,
  }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { ...config, help: true }
    if (arg === '--tags') {
      config.tags = true
      continue
    }
    if (arg.startsWith('--trace-id=')) {
      config.traceId = arg.slice('--trace-id='.length)
      continue
    }
    if (arg.startsWith('--limit=')) {
      config.limit = Number(arg.slice('--limit='.length))
      continue
    }
    if (arg.startsWith('--from=')) {
      config.from = arg.slice('--from='.length)
      continue
    }
    if (arg.startsWith('--format=')) {
      config.format = arg.slice('--format='.length)
      continue
    }
    if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`)
    if (config.query) throw new Error(`unexpected extra argument: ${arg}`)
    config.query = arg
  }

  if (!Number.isInteger(config.limit) || config.limit < 1) {
    throw new Error('--limit must be a positive integer')
  }
  if (!['tree', 'ndjson', 'json'].includes(config.format)) {
    throw new Error('--format must be tree, ndjson, or json')
  }
  if ([config.tags, Boolean(config.traceId), Boolean(config.query)].filter(Boolean).length !== 1 && !config.help) {
    throw new Error('provide exactly one of --tags, --trace-id=<hex>, or <traceql>')
  }

  return config
}

const parseDurationMs = (value) => {
  const match = /^(\d+)(s|m|h|d)$/.exec(value)
  if (!match) throw new Error('--from must be a duration like 30m, 6h, or 1d')
  const amount = Number(match[1])
  const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]
  return amount * unitMs
}

const tempoGetJson = async (tempoAddr, path, params = {}) => {
  const url = new URL(path, tempoAddr)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`)
  return JSON.parse(text)
}

const readOtelValue = (value) => {
  if (!value || typeof value !== 'object') return undefined
  if ('stringValue' in value) return value.stringValue
  if ('intValue' in value) return Number(value.intValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('boolValue' in value) return Boolean(value.boolValue)
  return undefined
}

const attrsToObject = (attributes = []) =>
  Object.fromEntries(attributes.map(({ key, value }) => [key, readOtelValue(value)]))

const base64ToHex = (value) => value ? Buffer.from(value, 'base64').toString('hex') : ''

const nsToMs = (value) => Number(value || 0) / 1_000_000

const traceResourceSpans = (payload) => payload.trace?.resourceSpans || payload.resourceSpans || payload.batches || []

const flattenTrace = (payload) =>
  traceResourceSpans(payload).flatMap((resourceSpan) => {
    const resourceAttrs = attrsToObject(resourceSpan.resource?.attributes)
    return (resourceSpan.scopeSpans || []).flatMap((scopeSpan) =>
      (scopeSpan.spans || []).map((span) => {
        const startNs = Number(span.startTimeUnixNano || 0)
        const endNs = Number(span.endTimeUnixNano || 0)
        return {
          traceId: base64ToHex(span.traceId),
          spanId: base64ToHex(span.spanId),
          parentSpanId: base64ToHex(span.parentSpanId),
          name: span.name || '<unnamed>',
          durationMs: nsToMs(endNs - startNs),
          startTimeUnixNano: span.startTimeUnixNano,
          serviceName: resourceAttrs['service.name'],
          serviceInstanceId: resourceAttrs['service.instance.id'],
          resourceAttrs,
          spanAttrs: attrsToObject(span.attributes),
          scopeName: scopeSpan.scope?.name,
        }
      }),
    )
  })

const formatMs = (value) => value >= 1 ? `${value.toFixed(2)}ms` : `${(value * 1_000).toFixed(0)}us`

const compactAttrs = (span) => {
  const interesting = {
    service: span.serviceName,
    run: span.serviceInstanceId,
    project: span.spanAttrs.project,
    port: span.spanAttrs.port,
    outcome: span.spanAttrs.outcome,
    owner: span.spanAttrs['owner.nonce'],
    path: span.spanAttrs.targetProjectPath || span.spanAttrs.projectRoot || span.spanAttrs.watchedFolderPath,
  }
  return Object.entries(interesting)
    .filter(([, value]) => value !== undefined && value !== '')
    .slice(0, 4)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
}

const renderTraceTree = (payload) => {
  const spans = flattenTrace(payload).sort((a, b) => Number(a.startTimeUnixNano) - Number(b.startTimeUnixNano))
  const byId = new Map(spans.map((span) => [span.spanId, { ...span, children: [] }]))
  const roots = []

  for (const span of byId.values()) {
    const parent = byId.get(span.parentSpanId)
    if (parent) parent.children.push(span)
    else roots.push(span)
  }

  const traceId = spans[0]?.traceId || '<unknown>'
  const services = [...new Set(spans.map((span) => span.serviceName).filter(Boolean))].join(',') || '<none>'
  const lines = [`trace ${traceId} spans=${spans.length} services=${services}`]
  const visit = (span, prefix, last) => {
    const connector = last ? '`- ' : '+- '
    const attrs = compactAttrs(span)
    lines.push(`${prefix}${connector}${span.name} ${formatMs(span.durationMs)}${attrs ? ` ${attrs}` : ''}`)
    const nextPrefix = `${prefix}${last ? '   ' : '|  '}`
    span.children.forEach((child, index) => visit(child, nextPrefix, index === span.children.length - 1))
  }
  roots.forEach((root, index) => visit(root, '', index === roots.length - 1))
  return lines.join('\n')
}

const renderSearchTree = (payload) => {
  const traces = payload.traces || []
  const lines = [`traces=${traces.length} inspectedBytes=${payload.metrics?.inspectedBytes || 0}`]
  for (const trace of traces) {
    const firstSpan = trace.spanSets?.[0]?.spans?.[0] || trace.spanSet?.spans?.[0]
    const durationNs = trace.durationMs
      ? Number(trace.durationMs) * 1_000_000
      : trace.traceDuration || trace.durationNanos || firstSpan?.durationNanos
    const duration = durationNs ? formatMs(nsToMs(durationNs)) : 'duration=?'
    lines.push(`${trace.traceID} ${trace.rootServiceName || '<service?>'} ${trace.rootTraceName || '<root?>'} ${duration} spans=${Object.values(trace.serviceStats || {}).reduce((sum, stat) => sum + Number(stat.spanCount || 0), 0)}`)
  }
  return lines.join('\n')
}

const renderTags = (payload, format) => {
  const rows = (payload.scopes || []).flatMap((scope) => (scope.tags || []).map((tag) => ({ scope: scope.name, tag })))
  if (format === 'json') return JSON.stringify(payload, null, 2)
  if (format === 'ndjson') return rows.map((row) => JSON.stringify(row)).join('\n')
  return rows.map((row) => `${row.scope}.${row.tag}`).join('\n')
}

const render = (kind, payload, format) => {
  if (kind === 'tags') return renderTags(payload, format)
  if (format === 'json') return JSON.stringify(payload, null, 2)
  if (kind === 'trace') {
    const spans = flattenTrace(payload)
    if (format === 'ndjson') return spans.map((span) => JSON.stringify(span)).join('\n')
    return renderTraceTree(payload)
  }
  const traces = payload.traces || []
  if (format === 'ndjson') return traces.map((trace) => JSON.stringify(trace)).join('\n')
  return renderSearchTree(payload)
}

const run = async (config) => {
  if (config.help) return usage()
  if (config.tags) return render('tags', await tempoGetJson(config.tempoAddr, '/api/v2/search/tags'), config.format)
  if (config.traceId) return render('trace', await tempoGetJson(config.tempoAddr, `/api/v2/traces/${config.traceId}`), config.format)

  const end = Math.floor(Date.now() / 1_000)
  const start = Math.floor((Date.now() - parseDurationMs(config.from)) / 1_000)
  const payload = await tempoGetJson(config.tempoAddr, '/api/search', {
    q: config.query,
    limit: config.limit,
    start,
    end,
  })
  return render('search', payload, config.format)
}

run(parseArgs(process.argv.slice(2)))
  .then((output) => {
    console.log(output)
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    console.error(usage())
    process.exit(1)
  })
