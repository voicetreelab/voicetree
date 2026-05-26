import { fetchNdjson } from '../data/manifest.js'

export const FIELD_GROUPS = [
  ['cpu', ['cpu_user_ms', 'cpu_sys_ms']],
  ['memory', ['rss', 'heap_used', 'heap_total', 'external', 'array_buffers']],
  ['event_loop', ['eld_p50_ms', 'eld_p99_ms']],
  ['gc', ['gc_pause_ms', 'gc_count']],
]

const SKIP_FIELDS = new Set(['t', 'svc'])

const CHART_COLORS = [
  '#9ce363',
  '#f0b35a',
  '#7db6ff',
  '#ff7a70',
  '#c9a7ff',
  '#67d7c4',
]

export function numericFieldsFromRows(rows, sampleSize = 10) {
  const fields = new Set()
  for (const row of rows.slice(0, sampleSize)) {
    for (const [key, value] of Object.entries(row)) {
      if (!SKIP_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
        fields.add(key)
      }
    }
  }
  return [...fields]
}

export function groupFields(numericFields, fieldGroups = FIELD_GROUPS) {
  const remaining = new Set(numericFields)
  const groups = []

  for (const [groupName, fields] of fieldGroups) {
    const present = fields.filter((field) => remaining.has(field))
    if (present.length === 0) continue
    groups.push([groupName, present])
    for (const field of present) remaining.delete(field)
  }

  for (const field of remaining) {
    groups.push([field, [field]])
  }

  return groups
}

function clear(slot) {
  slot.replaceChildren()
}

function mountMessage(slot, message) {
  clear(slot)
  const note = document.createElement('p')
  note.className = 'panel-note'
  note.textContent = message
  slot.append(note)
}

function chartLabels(rows) {
  const first = rows[0]?.t
  return rows.map((row, index) => {
    if (typeof row.t !== 'number' || typeof first !== 'number') return String(index + 1)
    return `${Math.max(0, Math.round((row.t - first) / 1000))}s`
  })
}

function datasetForField(rows, field, index) {
  return {
    label: field,
    data: rows.map((row) => typeof row[field] === 'number' ? row[field] : null),
    borderColor: CHART_COLORS[index % CHART_COLORS.length],
    backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.2,
    spanGaps: true,
  }
}

function formatTick(value) {
  const abs = Math.abs(Number(value))
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}b`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function mountChart(slot, svc, groupName, rows, fields) {
  const panel = document.createElement('section')
  panel.className = 'metric-panel'

  const heading = document.createElement('h4')
  heading.textContent = `${svc} · ${groupName}`

  const canvasWrap = document.createElement('div')
  canvasWrap.className = 'chart-frame'
  const canvas = document.createElement('canvas')
  canvasWrap.append(canvas)

  panel.append(heading, canvasWrap)
  slot.append(panel)

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: chartLabels(rows),
      datasets: fields.map((field, index) => datasetForField(rows, field, index)),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#ece4d2', boxWidth: 12 } },
      },
      scales: {
        x: {
          ticks: { color: '#a39676', maxTicksLimit: 8 },
          grid: { color: 'rgba(61, 50, 32, 0.5)' },
        },
        y: {
          ticks: { color: '#a39676', callback: formatTick },
          grid: { color: 'rgba(61, 50, 32, 0.5)' },
        },
      },
    },
  })
}

export async function render(slot, svc, metricsUrl) {
  mountMessage(slot, 'Loading metrics...')
  const rows = await fetchNdjson(metricsUrl)
  if (rows.length === 0) {
    mountMessage(slot, 'No metric rows captured.')
    return
  }

  const groups = groupFields(numericFieldsFromRows(rows), FIELD_GROUPS)
  clear(slot)
  for (const [groupName, fields] of groups) {
    mountChart(slot, svc, groupName, rows, fields)
  }
}
