// Self-time aggregation over an OTLP-JSON spans NDJSON file.
//
// Self-time of a span = its wall duration minus the summed wall duration of its
// direct children (same trace, parentSpanId === spanId). Aggregated by span
// name across the whole run, this attributes blocking/CPU cost to the frame
// that actually spent it rather than to its callees — the metric used to rank
// the storm's worst perf offenders.
//
// Usage:
//   node packages/measures/scripts/span-self-time.mjs <spans.ndjson> [nameFilter]
//
// With a nameFilter substring, prints the per-name self/wall percentiles for
// matching span names; otherwise prints the top offenders by self-time sum.
import { readFileSync } from 'node:fs'

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return 0
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1)
  return sortedMs[Math.max(0, idx)]
}

function loadSpans(path) {
  const spans = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const batch = JSON.parse(line)
    for (const rs of batch.resourceSpans ?? []) {
      const service = (rs.resource?.attributes ?? []).find(a => a.key === 'service.name')?.value?.stringValue ?? '?'
      for (const ss of rs.scopeSpans ?? []) {
        for (const s of ss.spans ?? []) {
          spans.push({
            service,
            name: s.name,
            traceId: s.traceId,
            spanId: s.spanId,
            parentSpanId: s.parentSpanId,
            durMs: (Number(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano))) / 1e6,
          })
        }
      }
    }
  }
  return spans
}

function selfTimes(spans) {
  // Sum of direct-child wall durations, keyed by (traceId|parentSpanId).
  const childDur = new Map()
  for (const s of spans) {
    if (!s.parentSpanId) continue
    const key = `${s.traceId}|${s.parentSpanId}`
    childDur.set(key, (childDur.get(key) ?? 0) + s.durMs)
  }
  return spans.map(s => {
    const kids = childDur.get(`${s.traceId}|${s.spanId}`) ?? 0
    return { ...s, selfMs: Math.max(0, s.durMs - kids) }
  })
}

function aggregateByName(withSelf) {
  const byName = new Map()
  for (const s of withSelf) {
    if (!byName.has(s.name)) byName.set(s.name, { name: s.name, service: s.service, self: [], wall: [] })
    const e = byName.get(s.name)
    e.self.push(s.selfMs)
    e.wall.push(s.durMs)
  }
  return [...byName.values()].map(e => {
    const self = [...e.self].sort((a, b) => a - b)
    const wall = [...e.wall].sort((a, b) => a - b)
    return {
      name: e.name,
      service: e.service,
      count: self.length,
      selfSumMs: self.reduce((a, b) => a + b, 0),
      selfP50: percentile(self, 50),
      selfP99: percentile(self, 99),
      wallP50: percentile(wall, 50),
      wallP99: percentile(wall, 99),
    }
  })
}

const [path, nameFilter] = process.argv.slice(2)
if (!path) {
  console.error('usage: span-self-time.mjs <spans.ndjson> [nameFilter]')
  process.exit(1)
}

const agg = aggregateByName(selfTimes(loadSpans(path)))
const rows = nameFilter
  ? agg.filter(r => r.name.includes(nameFilter)).sort((a, b) => b.selfSumMs - a.selfSumMs)
  : agg.sort((a, b) => b.selfSumMs - a.selfSumMs).slice(0, 15)

const fmt = n => n.toFixed(1).padStart(8)
console.log(`${'count'.padStart(6)} ${'selfSum'.padStart(9)} ${'selfP50'.padStart(8)} ${'selfP99'.padStart(8)} ${'wallP50'.padStart(8)} ${'wallP99'.padStart(8)}  name`)
for (const r of rows) {
  console.log(`${String(r.count).padStart(6)} ${fmt(r.selfSumMs)} ${fmt(r.selfP50)} ${fmt(r.selfP99)} ${fmt(r.wallP50)} ${fmt(r.wallP99)}  ${r.name}  [${r.service}]`)
}
