import { esc, fmtMSS } from './format.js'

// Duration tiers — calibrated to the dev's hand-feel of "fast vs slow".
// Returned classname gets applied to the box; the order is also the visual
// severity (instant < quick < notable < slow < egregious).
const TIER = (ms) => {
  if (ms >= 300_000) return 'egregious' // 5min+ — red
  if (ms >= 60_000)  return 'slow'      // 1-5min — orange
  if (ms >= 10_000)  return 'notable'   // 10-60s — caution
  if (ms >= 1_000)   return 'quick'     // 1-10s — neutral
  return 'instant'                       // <1s — muted
}

const TOP_N = 6                 // big-card lineup
const BAR_COVERAGE = 0.92       // stack slices until they cover this share

function totalMs(reports) {
  return reports.reduce((sum, r) => sum + (Number.isFinite(r.durationMs) ? r.durationMs : 0), 0)
}

function timedSorted(reports) {
  return reports
    .filter(r => Number.isFinite(r.durationMs) && r.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs)
}

function renderBigBox(r, total) {
  const tier = TIER(r.durationMs)
  const pct = total > 0 ? (r.durationMs / total) * 100 : 0
  const statusCls = r.status === 'fail' ? 'is-fail' : r.status === 'skip' ? 'is-skip' : 'is-pass'
  const statusTxt = r.status === 'fail' ? 'FAIL' : r.status === 'skip' ? 'SKIP' : 'PASS'
  return `<div class="wc-box wc-${tier} ${statusCls}" data-id="${esc(r.checkId)}" title="${esc(r.checkName)} · ${esc(r.command)}">
    <div class="wc-box-time">${fmtMSS(r.durationMs)}</div>
    <div class="wc-box-name">${esc(r.checkName)}</div>
    <div class="wc-box-foot">
      <span class="wc-box-status">${statusTxt}</span>
      <span class="wc-box-share">${pct.toFixed(0)}%</span>
    </div>
  </div>`
}

function renderStackBar(reports, total) {
  if (total <= 0) return ''
  const sorted = timedSorted(reports)
  const slices = []
  let acc = 0
  for (const r of sorted) {
    if (acc / total >= BAR_COVERAGE && slices.length >= 4) break
    slices.push(r)
    acc += r.durationMs
  }
  const otherMs = total - acc
  const stack = slices.map(r => {
    const pct = (r.durationMs / total) * 100
    const tier = TIER(r.durationMs)
    return `<span class="wc-stack-seg wc-stack-${tier}" style="width:${pct.toFixed(2)}%" title="${esc(r.checkName)} — ${fmtMSS(r.durationMs)} (${pct.toFixed(0)}%)"></span>`
  }).join('')
  const otherSeg = otherMs > 1000
    ? `<span class="wc-stack-seg wc-stack-other" style="width:${((otherMs / total) * 100).toFixed(2)}%" title="Other ${sorted.length - slices.length} checks — ${fmtMSS(otherMs)}"></span>`
    : ''
  const legendItems = slices.slice(0, 4).map(r => {
    const tier = TIER(r.durationMs)
    return `<span class="wc-stack-legend-item"><span class="wc-stack-dot wc-stack-${tier}"></span>${esc(r.checkName)} · ${fmtMSS(r.durationMs)}</span>`
  }).join('')
  return `<div class="wc-stack">
    <div class="wc-stack-bar">${stack}${otherSeg}</div>
    <div class="wc-stack-legend">${legendItems}</div>
  </div>`
}

export function renderWallClock(reports) {
  const sorted = timedSorted(reports)
  if (sorted.length === 0) return ''

  const total = totalMs(sorted)
  const top = sorted.slice(0, TOP_N)
  const slowCount = sorted.filter(r => r.durationMs >= 60_000).length
  const headlineNote = slowCount > 0
    ? `<span class="wc-note"><span class="wc-note-num">${slowCount}</span> over 1m</span>`
    : `<span class="wc-note">all under 1m</span>`

  return `<div class="wc-panel">
    <div class="wc-head">
      <div class="wc-headline">
        <div class="wc-headline-label">total wall-clock</div>
        <div class="wc-headline-time">${fmtMSS(total)}</div>
      </div>
      <div class="wc-head-meta">
        ${headlineNote}
        <span class="wc-meta-sep">·</span>
        <span class="wc-note">${sorted.length} timed checks</span>
      </div>
    </div>
    <div class="wc-boxes">${top.map(r => renderBigBox(r, total)).join('')}</div>
    ${renderStackBar(sorted, total)}
  </div>`
}
