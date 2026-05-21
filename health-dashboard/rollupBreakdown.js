import { esc, fmtDuration, relTime } from './format.js'

// Composition map for known rollup ("Command" category) checks.
// Each rollup is wrapped by record-run.mjs and writes its own report. The
// scripts it transitively invokes also write their own reports — those are the
// `components`. We render rollup duration alongside the sum of its components,
// so the dev can see WHERE the time goes (and what fraction is unaccounted).
//
// Sub-rollups (e.g. npm-test pulls in npm-health) are kept as a single segment
// rather than expanded inline. They appear as their own breakdown row below,
// so drilling down is "scroll down", not "click to expand". One screen, no
// state.
const ROLLUPS = [
  {
    id: 'npm-test',
    name: 'npm run test',
    note: 'npm run health  +  vitest  +  electron-vite build  +  native rebuild  +  playwright tier1  +  playwright tier2 browser',
    components: [
      { id: 'npm-health',         label: 'npm run health',                  kind: 'rollup' },
      { id: 'webapp-unit',        label: 'Webapp Unit (vitest)',            kind: 'leaf' },
      { id: 'webapp-vite-build',  label: 'Webapp electron-vite build',      kind: 'leaf' },
      { id: 'native-rebuild',     label: 'Native module rebuild',           kind: 'leaf' },
      { id: 'playwright-tier1',   label: 'Playwright Tier 1 (no rebuild)',  kind: 'leaf' },
      { id: 'e2e-tier2-browser',  label: 'E2E Tier 2 (Browser)',            kind: 'leaf' },
    ],
  },
  {
    id: 'npm-check',
    name: 'npm run check',
    note: 'webapp check  +  root lint suite',
    components: [
      { id: 'webapp-check',            label: 'Webapp TypeCheck + Lint + E2E Taxonomy', kind: 'leaf' },
      { id: 'root-lint',               label: 'Root ESLint',                            kind: 'leaf' },
      { id: 'verify-cytoscape-rules',  label: 'Cytoscape Lint Rules',                   kind: 'leaf' },
      { id: 'blackbox-tests-lint',     label: 'Blackbox Test Lint',                     kind: 'leaf' },
    ],
  },
  {
    id: 'npm-health',
    name: 'npm run health',
    note: 'tier-1 system contracts  +  systems-health vitest  +  static checks  +  duplication',
    components: [
      { id: 'graph-db-client-e2e-system',     label: 'Graph DB Client E2E',       kind: 'leaf' },
      { id: 'graph-db-server-e2e-system',     label: 'Graph DB Server E2E',       kind: 'leaf' },
      { id: 'graph-model-public-api-contract',label: 'Graph Model Public API',    kind: 'leaf' },
      { id: 'graph-state-public-api-contract',label: 'Graph State Public API',    kind: 'leaf' },
      { id: 'graph-tools-e2e-system',         label: 'Graph Tools E2E',           kind: 'leaf' },
      { id: 'orange-gate',                    label: 'Orange Complexity Gate',    kind: 'leaf' },
      { id: 'relative-import-depth',          label: 'Relative Import Depth',     kind: 'leaf' },
      { id: 'relative-path-depth',            label: 'Relative Path Depth',       kind: 'leaf' },
      { id: 'systems-health',                 label: 'Systems Health (vitest)',   kind: 'leaf' },
      { id: 'dead-code',                      label: 'Dead Code (knip)',          kind: 'leaf' },
      { id: 'e2e-taxonomy',                   label: 'E2E Taxonomy',              kind: 'leaf' },
      { id: 'duplication',                    label: 'Code Duplication (jscpd)',  kind: 'leaf' },
    ],
  },
]

// Mirrors wallClock TIER (deliberately duplicated — different visual scale here:
// segments in a 100%-stacked bar should read by share, not absolute duration).
function tierForShare(pct) {
  if (pct >= 30) return 'egregious'
  if (pct >= 15) return 'slow'
  if (pct >= 5)  return 'notable'
  if (pct >= 1)  return 'quick'
  return 'instant'
}

function findReport(reports, id) {
  return reports.find(r => r.checkId === id) ?? null
}

// If components were measured in a different run than the rollup (different
// cache state, machine load, day), their durations don't reflect what happened
// inside this rollup invocation. We flag any component whose timestamp differs
// from the rollup's by more than this — that's the gap explanation, not "hidden
// work". 5 minutes is generous: a single capture run finishes in <5 min.
const STALE_WINDOW_MS = 5 * 60 * 1000

function ageGapMs(rollupTs, componentTs) {
  if (!rollupTs || !componentTs) return 0
  const a = Date.parse(rollupTs)
  const b = Date.parse(componentTs)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.abs(a - b)
}

function buildBreakdown(rollupDef, reports) {
  const rollup = findReport(reports, rollupDef.id)
  if (!rollup || !Number.isFinite(rollup.durationMs) || rollup.durationMs <= 0) return null

  const measured = []
  let measuredSum = 0
  let staleCount = 0
  let maxStaleMs = 0
  for (const c of rollupDef.components) {
    const r = findReport(reports, c.id)
    if (r && Number.isFinite(r.durationMs) && r.durationMs > 0) {
      const gap = ageGapMs(rollup.timestamp, r.timestamp)
      const isStale = gap > STALE_WINDOW_MS
      if (isStale) { staleCount++; maxStaleMs = Math.max(maxStaleMs, gap) }
      measured.push({ ...c, durationMs: r.durationMs, status: r.status, timestamp: r.timestamp, isStale })
      measuredSum += r.durationMs
    } else {
      measured.push({ ...c, durationMs: 0, status: r?.status ?? 'missing', isStale: false })
    }
  }
  // Sort by duration desc — biggest contributors read left-to-right.
  measured.sort((a, b) => b.durationMs - a.durationMs)

  // Three cases for the rollup-vs-components gap:
  //  A) staleCount > 0  →  components measured in a different run than the
  //     rollup. Gap is mostly measurement timing, not hidden work. Surface
  //     this as the explanation instead of "Uncaptured npm spawn ...".
  //  B) measuredSum < rollup.durationMs (fresh): real uncaptured work — npm
  //     spawn between &&-chained sub-steps, untracked commands, shell time.
  //  C) measuredSum > rollup.durationMs: standalone captures slower than in
  //     rollup (cold cache, no parallelism). Bar normalizes to measuredSum;
  //     rollup's own time becomes a tick mark.
  const overflow = Math.max(measuredSum - rollup.durationMs, 0)
  const uncapturedMs = Math.max(rollup.durationMs - measuredSum, 0)
  const denom = Math.max(rollup.durationMs, measuredSum)

  return { rollupDef, rollup, measured, measuredSum, uncapturedMs, overflow, denom, staleCount, maxStaleMs }
}

function renderSegment(seg, denom) {
  const pct = denom > 0 ? (seg.durationMs / denom) * 100 : 0
  if (pct <= 0) return ''
  const tier = tierForShare(pct)
  const klass = seg.kind === 'rollup' ? 'rb-seg-rollup' : ''
  const title = `${seg.label} — ${fmtDuration(seg.durationMs)} (${pct.toFixed(0)}%)${seg.kind === 'rollup' ? ' · sub-rollup' : ''}`
  return `<span class="rb-seg rb-${tier} ${klass}" style="width:${pct.toFixed(2)}%" data-id="${esc(seg.id)}" title="${esc(title)}"></span>`
}

function renderUncaptured(b) {
  if (b.uncapturedMs <= 0 || b.denom <= 0) return ''
  const pct = (b.uncapturedMs / b.denom) * 100
  if (pct < 0.5) return ''
  const tooltip = b.staleCount > 0
    ? `${fmtDuration(b.uncapturedMs)} unaccounted — ${b.staleCount} of ${b.measured.length} component${b.measured.length === 1 ? '' : 's'} measured in a different run (max ${fmtDuration(b.maxStaleMs)} apart from rollup). Re-run npm test to refresh.`
    : `${fmtDuration(b.uncapturedMs)} unaccounted — npm spawn between &&-chained sub-steps, untracked commands, or shell time inside the rollup`
  return `<span class="rb-seg rb-uncaptured" style="width:${pct.toFixed(2)}%" title="${esc(tooltip)}"></span>`
}

function renderLegendRow(seg, denom) {
  const pct = denom > 0 ? (seg.durationMs / denom) * 100 : 0
  const tier = seg.durationMs <= 0 ? 'missing' : tierForShare(pct)
  const dotKlass = seg.durationMs <= 0 ? 'rb-dot-missing' : `rb-${tier}`
  const tags = []
  if (seg.kind === 'rollup') tags.push('<span class="rb-leg-tag">rollup</span>')
  if (seg.isStale) tags.push('<span class="rb-leg-tag rb-leg-tag-stale" title="measured in a different run than the rollup">stale</span>')
  const dur = seg.durationMs > 0 ? fmtDuration(seg.durationMs) : '—'
  const share = seg.durationMs > 0 ? `${pct.toFixed(0)}%` : 'no recent run'
  return `<li class="rb-leg-row" data-id="${esc(seg.id)}">
    <span class="rb-leg-dot ${dotKlass}"></span>
    <span class="rb-leg-name">${esc(seg.label)}${tags.join('')}</span>
    <span class="rb-leg-time">${dur}</span>
    <span class="rb-leg-share">${share}</span>
  </li>`
}

function renderUncapturedLegendRow(b) {
  if (b.uncapturedMs <= 0) return ''
  const pct = b.denom > 0 ? (b.uncapturedMs / b.denom) * 100 : 0
  const tag = b.staleCount > 0
    ? `${b.staleCount}/${b.measured.length} components measured in different run · max ${fmtDuration(b.maxStaleMs)} apart`
    : 'npm spawn between sub-steps, shell overhead'
  const name = b.staleCount > 0 ? 'Likely measurement skew' : 'Uncaptured (genuinely)'
  return `<li class="rb-leg-row rb-leg-uncaptured">
    <span class="rb-leg-dot rb-uncaptured"></span>
    <span class="rb-leg-name">${name} <span class="rb-leg-tag">${esc(tag)}</span></span>
    <span class="rb-leg-time">${fmtDuration(b.uncapturedMs)}</span>
    <span class="rb-leg-share">${pct.toFixed(0)}%</span>
  </li>`
}

function renderRollupTick(b) {
  if (b.overflow <= 0 || b.denom <= 0) return ''
  const pct = (b.rollup.durationMs / b.denom) * 100
  return `<span class="rb-bar-tick" style="left:${pct.toFixed(2)}%" title="rollup ran in ${esc(fmtDuration(b.rollup.durationMs))} — components measured separately took ${esc(fmtDuration(b.measuredSum))}"></span>`
}

function renderBreakdown(b) {
  const total = b.rollup.durationMs
  const denom = b.denom
  const statusCls = b.rollup.status === 'fail' ? 'is-fail' : b.rollup.status === 'skip' ? 'is-skip' : 'is-pass'
  const statusTxt = b.rollup.status === 'fail' ? 'FAIL' : b.rollup.status === 'skip' ? 'SKIP' : 'PASS'

  const measuredCount = b.measured.filter(s => s.durationMs > 0).length
  const missingCount = b.measured.length - measuredCount

  const segments = b.measured.map(s => renderSegment(s, denom)).join('')
  const uncapturedSeg = renderUncaptured(b)
  const tick = renderRollupTick(b)

  const legendRows = b.measured.map(s => renderLegendRow(s, denom)).join('')
  const uncapturedRow = renderUncapturedLegendRow(b)

  const ranAt = b.rollup.timestamp ? `<span class="rb-meta-ran" title="${esc(b.rollup.timestamp)}">ran ${esc(relTime(b.rollup.timestamp))}</span>` : ''
  const missingNote = missingCount > 0
    ? `<span class="rb-meta-warn">${missingCount} component${missingCount === 1 ? '' : 's'} not yet captured</span>`
    : ''

  // Honest meta line. Three cases:
  //  - overmeasured (overflow > 0): standalone captures SLOWER than rollup
  //    itself (cold cache / no parallelism)
  //  - stale: rollup and components from different runs — gap is timing skew
  //  - fresh + undermeasured: real npm spawn / shell / untracked sub-step time
  const measurePct = total > 0 ? Math.round((b.measuredSum / total) * 100) : 0
  let measureLine
  if (b.overflow > 0) {
    measureLine = `<span class="rb-meta-sum">components captured separately: <strong>${fmtDuration(b.measuredSum)}</strong> · rollup ran in <strong>${fmtDuration(total)}</strong></span>
       <span class="rb-meta-warn">standalone captures slower by ${fmtDuration(b.overflow)} — likely cold cache or no parallelism</span>`
  } else if (b.staleCount > 0) {
    measureLine = `<span class="rb-meta-sum">measured <strong>${fmtDuration(b.measuredSum)}</strong> of ${fmtDuration(total)} (${measurePct}%)</span>
       <span class="rb-meta-warn">${b.staleCount} of ${b.measured.length} components from a different run (max ${fmtDuration(b.maxStaleMs)} apart) — re-run for coherent breakdown</span>`
  } else {
    measureLine = `<span class="rb-meta-sum">measured <strong>${fmtDuration(b.measuredSum)}</strong> of ${fmtDuration(total)} (${measurePct}%)</span>`
  }

  return `<article class="rb-row ${statusCls}" data-id="${esc(b.rollup.checkId)}">
    <header class="rb-head">
      <div class="rb-head-main">
        <span class="rb-head-name">${esc(b.rollupDef.name)}</span>
        <span class="rb-head-status">${statusTxt}</span>
      </div>
      <div class="rb-head-time">
        <span class="rb-head-total">${fmtDuration(total)}</span>
        <span class="rb-head-of">total wall-clock</span>
      </div>
    </header>
    <p class="rb-note">${esc(b.rollupDef.note)}</p>
    <div class="rb-bar">${segments}${uncapturedSeg}${tick}</div>
    <div class="rb-meta">
      ${measureLine}
      ${ranAt}
      ${missingNote}
    </div>
    <ul class="rb-legend">
      ${legendRows}
      ${uncapturedRow}
    </ul>
  </article>`
}

export function renderRollupBreakdown(reports) {
  if (!Array.isArray(reports) || reports.length === 0) return ''
  const breakdowns = ROLLUPS.map(def => buildBreakdown(def, reports)).filter(Boolean)
  if (breakdowns.length === 0) return ''

  const rows = breakdowns.map(renderBreakdown).join('')
  return `<section class="rb-panel" aria-label="Rollup wall-clock breakdown">
    <header class="rb-panel-head">
      <div>
        <h2 class="rb-panel-title">Rollup breakdown</h2>
        <p class="rb-panel-sub">Where the slowest top-level commands spend their wall-clock. Sub-rollups appear as a single segment — their own breakdown is below.</p>
      </div>
      <span class="rb-panel-tally">${breakdowns.length} rollup${breakdowns.length === 1 ? '' : 's'}</span>
    </header>
    ${rows}
  </section>`
}
