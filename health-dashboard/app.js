import { esc, fmtNum, relTime, isStale } from './format.js'
import { renderChecksSection, bindChecksSection } from './checks.js'
import { renderWallClock } from './wallClock.js'
import { renderRollupBreakdown } from './rollupBreakdown.js'
import { renderFileTreeSection } from './fileTree.js'
import { renderTreemapSection, bindTreemapSection } from './treemap.js'
import { renderGitSection, renderGitTally, renderGitFolders, renderGitCommits } from './git.js'
import { getMetricExplanation } from './metricExplanations.js'
import { bindCardExplainToggles } from './explainToggle.js'
import { isGate, gatesShown, renderGatesSection, bindGatesToggle } from './gates.js'
import { bindCopyButtons } from './copyStatus.js'

const REPORTS_URL = 'reports/latest.json'
const CHECKS_URL = 'reports/checks.json'
const MANIFEST_URL = 'api/checks/manifest'
const GIT_URL = 'api/git'
const GIT_POLL_MS = 5000

// Mutable holder so copy-button click handlers always read the latest data,
// including git data refreshed by the background poll.
const liveState = { data: null, checksData: null, gitData: null }
const CATEGORY_ORDER = ['Coupling', 'Complexity', 'Structure', 'Purity', 'Behavioral', 'Shape', 'Churn', 'Other']
const HEALTH_AXES = [
  {
    name: 'Structural',
    note: 'Import-graph topology. False-negatives: module-mutable state (see graph-db-server/state).',
    metricIds: ['hierarchical-complexity', 'treewidth', 'modularity-q', 'boundary-width-ratio', 'graph-entropy'],
    match: (r) => ['hierarchical-complexity', 'treewidth', 'modularity-q', 'boundary-width-ratio', 'graph-entropy'].includes(r.metricId),
  },
  {
    name: 'Behavioral',
    note: 'Side effects, mutation, hidden state. False-negatives: pure functions in a god-controller.',
    metricIds: ['purity-ratio-ast', 'purity-ratio'],
    match: (r) => r.metricId === 'purity-ratio-ast' || r.metricId === 'purity-ratio' || r.metricId.startsWith('globals-'),
  },
  {
    name: 'Shape',
    note: 'Function size + interface narrowness. False-negatives: tiny well-formed functions composed into a deep tangled call tree.',
    metricIds: ['function-health', 'purity-ast-p90-function-loc', 'exports-per-file-p90', 'exports-per-file-max'],
    match: (r) => ['function-health', 'purity-ast-p90-function-loc', 'exports-per-file-p90', 'exports-per-file-max'].includes(r.metricId),
  },
]

// ── Gauge / Utilization ───────────────────────────────────────────────────────

function gaugePct(report) {
  if (report.budget === 0) return report.current === 0 ? 0 : 100
  const ratio = report.current / report.budget
  return Math.min(Math.max(ratio * 100, 0), 100)
}

function utilization(r) {
  if (r.comparison === 'lte') {
    if (r.budget === 0) return r.current === 0 ? 0 : Infinity
    return r.current / r.budget
  }
  if (r.current === 0) return r.budget === 0 ? 0 : Infinity
  return r.budget / r.current
}

// Replace Infinity (budget=0, current>0) with a finite stand-in so the bar
// stays renderable. Caller passes the max finite ratio in the dataset; we go
// slightly past it so '∞' visibly outranks every concrete failure.
function utilizationForBar(u, maxFinite) {
  if (Number.isFinite(u)) return u
  return Math.max(maxFinite * 1.25, 2)
}

// ── Card ──────────────────────────────────────────────────────────────────────

function renderCard(r) {
  const stale = isStale(r.timestamp)
  const cls   = stale ? 'is-stale' : r.passed ? '' : 'is-fail'

  const badgeCls  = stale ? 'badge-stale' : r.passed ? 'badge-pass' : 'badge-fail'
  const badgeTxt  = stale ? 'STALE' : r.passed ? 'PASS' : 'FAIL'

  const pct    = gaugePct(r)
  const unit   = r.unit ? ` ${esc(r.unit)}` : ''
  const rel    = relTime(r.timestamp)
  const staleDot = stale ? `<span class="stale-dot" title="Last run >7 days ago">⚠ stale</span>` : ''

  const explanation = getMetricExplanation(r)

  return `<div class="metric-card ${cls}" data-id="${esc(r.metricId)}">
  <div class="card-head">
    <span class="card-name">${esc(r.metricName)}</span>
    <button class="card-info-btn" type="button" aria-expanded="false" aria-label="Explain ${esc(r.metricName)}" title="Explain this measure">
      <span class="card-info-glyph" aria-hidden="true">i</span>
    </button>
    <span class="badge ${badgeCls}">${badgeTxt}</span>
  </div>
  <p class="card-desc">${esc(r.description)}</p>
  <div class="card-explain" hidden>
    <p>${esc(explanation)}</p>
  </div>
  <div class="card-values">
    <span class="val-current">${fmtNum(r.current)}</span>
    <span class="val-sep">/</span>
    <span class="val-budget">${fmtNum(r.budget)}</span><span class="val-unit">${unit}</span>
  </div>
  <div>
    <div class="gauge-track"><div class="gauge-fill" style="width:${pct}%"></div></div>
  </div>
  <div class="card-footer">
    <time title="${esc(r.timestamp)}">${rel}</time>${staleDot}
  </div>
</div>`
}


function renderCategory(name, reports) {
  const pass  = reports.filter(r => r.passed).length
  const total = reports.length
  const fail  = total - pass

  const tallyHtml = fail > 0
    ? `<span class="t-pass">${pass}</span> / <span class="t-fail">${total}</span>`
    : `<span class="t-pass">${pass}</span> / ${total}`

  return `<section class="category-section" data-cat="${esc(name)}">
  <div class="category-header">
    <span class="category-name">${esc(name)}</span>
    <span class="category-rule"></span>
    <span class="category-tally">${tallyHtml} passing</span>
  </div>
  <div class="card-grid">${reports.map(renderCard).join('')}</div>
</section>`
}

function axisReportOrder(axis, report) {
  if (report.metricId.startsWith('globals-')) return 100 + report.metricId.localeCompare('globals-')
  const index = axis.metricIds.indexOf(report.metricId)
  return index === -1 ? 1000 : index
}

function axisReports(axis, reports) {
  return reports
    .filter(axis.match)
    .sort((a, b) => axisReportOrder(axis, a) - axisReportOrder(axis, b) || a.metricName.localeCompare(b.metricName))
}

function renderAxis(axis, reports) {
  const axisItems = axisReports(axis, reports)
  const pass = axisItems.filter(r => r.passed).length
  const total = axisItems.length
  const fail = total - pass
  const tallyHtml = fail > 0
    ? `<span class="t-pass">${pass}</span> / <span class="t-fail">${total}</span>`
    : `<span class="t-pass">${pass}</span> / ${total}`

  return `<section class="axis-section" data-axis="${esc(axis.name)}">
  <div class="axis-header">
    <div>
      <h2 class="axis-name">${esc(axis.name)}</h2>
      <p class="axis-note">${esc(axis.note)}</p>
    </div>
    <span class="axis-tally">${tallyHtml} passing</span>
  </div>
  <div class="card-grid">${axisItems.map(renderCard).join('')}</div>
</section>`
}

function renderAxes(reports) {
  const axesHtml = HEALTH_AXES.map(axis => renderAxis(axis, reports)).join('')
  return `<section class="axis-banner">
  These axes are NOT combined. Each has its own false-negative class. All three gates must pass independently.
</section>${axesHtml}`
}

function groupedMetricIds(reports) {
  return new Set(HEALTH_AXES.flatMap(axis => axisReports(axis, reports).map(report => report.metricId)))
}

// ── Ranking bar chart (Chart.js horizontal) ───────────────────────────────────

let _ranking = null

function renderRanking(reports) {
  const canvas = document.getElementById('ranking-chart')
  if (!canvas || typeof Chart === 'undefined') return

  const ranked = [...reports].sort((a, b) => utilization(b) - utilization(a))
  const labels = ranked.map(r => r.metricName)
  const real   = ranked.map(utilization)
  const maxFinite = real.reduce((m, u) => Number.isFinite(u) && u > m ? u : m, 1.2)
  const bars   = real.map(u => utilizationForBar(u, maxFinite))
  const axisMax = Math.max(maxFinite * 1.4, 1.5)
  const colors = ranked.map(r => r.passed ? 'rgba(156,227,99,0.88)' : 'rgba(255,68,56,0.92)')

  const wrap = canvas.parentElement
  if (wrap) wrap.style.height = `${Math.max(320, ranked.length * 24 + 90)}px`

  const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace"
  const FONT_SERIF = "'Fraunces', Georgia, serif"

  if (_ranking) _ranking.destroy()
  _ranking = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: bars,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 0,
        barThickness: 12,
        maxBarThickness: 14,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0c0a06',
          borderColor: '#3d3220',
          borderWidth: 1,
          padding: 12,
          titleColor: '#ece4d2',
          bodyColor: '#a39676',
          titleFont: { size: 12, family: FONT_SERIF, weight: '500', style: 'italic' },
          bodyFont:  { size: 11, family: FONT_MONO },
          displayColors: false,
          cornerRadius: 0,
          callbacks: {
            title: (items) => ranked[items[0].dataIndex].metricName,
            label: (ctx) => {
              const r = ranked[ctx.dataIndex]
              const u = real[ctx.dataIndex]
              const uTxt = Number.isFinite(u) ? `${u.toFixed(2)}× budget` : '∞× budget'
              const cmpTxt = r.comparison === 'lte' ? `≤ ${fmtNum(r.budget)}` : `≥ ${fmtNum(r.budget)}`
              return [
                `${r.passed ? '[ PASS ]' : '[ FAIL ]'}  ${uTxt}`,
                `current ${fmtNum(r.current)}  /  budget ${cmpTxt}`,
              ]
            },
          }
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          suggestedMin: 0,
          max: axisMax,
          grid: {
            color: (ctx) => Math.abs(ctx.tick.value - 1.0) < 0.001 ? 'rgba(255,68,56,0.55)' : 'rgba(44,36,24,0.55)',
            lineWidth: (ctx) => Math.abs(ctx.tick.value - 1.0) < 0.001 ? 1.5 : 1,
          },
          border: { color: '#3d3220' },
          ticks: {
            color: '#a39676',
            font: { size: 10, family: FONT_MONO },
            callback: (v) => `${v.toFixed(1)}×`,
          },
          title: {
            display: true,
            text: 'budget utilization — 1.0× at budget · >1× failing',
            color: '#6b6047',
            font: { size: 10, family: FONT_MONO, weight: '400' },
            padding: { top: 10 },
          },
        },
        y: {
          grid: { display: false },
          border: { color: '#3d3220' },
          ticks: {
            color: '#ece4d2',
            font: { size: 11, family: FONT_SERIF, style: 'normal', weight: '500' },
            autoSkip: false,
          },
        }
      }
    }
  })
}

// ── Header ────────────────────────────────────────────────────────────────────

function updateHeader(reports, generatedAt) {
  const pass = reports.filter(r => r.passed).length
  const fail = reports.length - pass

  const summaryText = document.getElementById('summary-text')
  if (summaryText) {
    summaryText.innerHTML = `
      <div>
        <span class="summary-label">Passing</span>
        <span class="summary-pass">${pass}</span>
      </div>
      <div>
        <span class="summary-label">Failing</span>
        <span class="summary-fail">${fail}</span>
      </div>`
  }

  const updEl = document.getElementById('updated-at')
  if (updEl && generatedAt) {
    updEl.textContent = `Updated ${relTime(generatedAt)}`
    updEl.title = generatedAt
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function renderDashboard(data, checksData, gitData) {
  updateHeader(data.reports, data.generatedAt)

  const gates  = data.reports.filter(isGate)
  const scored = data.reports.filter(r => !isGate(r))

  const byCategory = Object.fromEntries(CATEGORY_ORDER.map(c => [c, []]))
  for (const r of data.reports) {
    const cat = CATEGORY_ORDER.includes(r.category) ? r.category : 'Other'
    byCategory[cat].push(r)
  }

  const gitHtml    = renderGitSection(gitData)
  const wallClockHtml = renderWallClock(checksData?.reports ?? [])
  const rollupBreakdownHtml = renderRollupBreakdown(checksData?.reports ?? [])
  const checksHtml = renderChecksSection(checksData)
  const gatesHtml  = renderGatesSection(gates, gatesShown())
  const axesHtml = renderAxes(data.reports)
  const fileTreeHtml = renderFileTreeSection(data.reports)
  const treemapHtml = renderTreemapSection(data.reports)

  const rankingHtml = scored.length === 0 ? '' : `
<section class="ranking-section">
  <div class="category-header">
    <span class="category-name">Metric Ranking — Worst First</span>
    <span class="category-rule"></span>
    <span class="category-tally">budget utilization · ${scored.length} scored${gates.length > 0 ? ` · ${gates.length} gates excluded` : ''}</span>
  </div>
  <div class="ranking-wrap"><canvas id="ranking-chart" aria-label="Metric ranking bar chart"></canvas></div>
</section>`

  const axisMetricIds = groupedMetricIds(data.reports)
  const categoriesHtml = CATEGORY_ORDER
    .map(c => [c, byCategory[c].filter(report => !axisMetricIds.has(report.metricId))])
    .filter(([, reports]) => reports.length > 0)
    .map(([c, reports]) => renderCategory(c, reports))
    .join('')

  const main = document.getElementById('main')
  main.innerHTML = gitHtml + wallClockHtml + rollupBreakdownHtml + checksHtml + gatesHtml + axesHtml + fileTreeHtml + treemapHtml + rankingHtml + categoriesHtml
  bindChecksSection(main, checksData)
  bindGatesToggle(main)
  bindTreemapSection(main, data.reports)
  bindCardExplainToggles(main)
  bindCopyButtons(main, () => ({
    reports: liveState.data?.reports ?? [],
    checksData: liveState.checksData,
    gitData: liveState.gitData,
    axisDefs: HEALTH_AXES,
    categoryOrder: CATEGORY_ORDER,
  }))

  if (scored.length > 0) renderRanking(scored)
}

function renderEmpty() {
  document.getElementById('main').innerHTML = `
<div class="state-empty">
  <div class="state-empty-icon">📊</div>
  <h2>No health reports found</h2>
  <p>Run the test suite to generate reports:</p>
  <code>npm run test:measures</code>
</div>`
}

function renderLoading() {
  document.getElementById('main').innerHTML = `
<div class="state-loading"><div class="spinner"></div><p>Loading reports…</p></div>`
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function renderError(err) {
  const main = document.getElementById('main')
  if (!main) return
  const msg = err && err.stack ? err.stack : String(err)
  main.innerHTML = `<div class="state-empty">
    <div class="state-empty-icon">!</div>
    <h2>Dashboard failed to render</h2>
    <p>Open the browser console for the full trace, or hard-reload (⇧⌘R) if you just pulled changes.</p>
    <code style="white-space:pre-wrap; text-align:left; max-width:80ch;">${esc(msg)}</code>
  </div>`
}

function mergeManifest(checksData, manifestData) {
  const captured = checksData?.reports ?? []
  const manifest = manifestData?.checks ?? []
  if (manifest.length === 0) return checksData ?? { reports: captured }
  const manifestById = new Map(manifest.map(c => [c.id, c]))
  // Backfill measurePath/tier/concern onto captured reports when missing.
  // Captured JSONs from before the tier refactor lack details.measurePath and
  // would otherwise fall into the untiered bucket on the dashboard.
  const enrichedCaptured = captured.map(r => {
    const m = manifestById.get(r.checkId)
    if (!m) return r
    const details = { ...(r.details ?? {}) }
    if (!details.measurePath) details.measurePath = m.measurePath
    if (details.tier === undefined) details.tier = m.tier
    if (!details.concern) details.concern = m.concern
    return { ...r, details }
  })
  const capturedIds = new Set(captured.map(r => r.checkId))
  const synthesized = manifest
    .filter(c => !capturedIds.has(c.id))
    .map(c => ({
      checkId: c.id,
      checkName: c.name,
      category: c.category,
      command: c.display,
      status: 'never-run',
      durationMs: 0,
      timestamp: null,
      details: { measurePath: c.measurePath, tier: c.tier, concern: c.concern },
    }))
  return { ...(checksData ?? {}), reports: [...enrichedCaptured, ...synthesized] }
}

async function load() {
  renderLoading()
  try {
    const [data, checksData, manifestData, gitData] = await Promise.all([
      fetchJson(REPORTS_URL),
      fetchJson(CHECKS_URL),
      fetchJson(MANIFEST_URL),
      fetchJson(GIT_URL),
    ])

    const mergedChecks = mergeManifest(checksData, manifestData)
    liveState.data = data
    liveState.checksData = mergedChecks
    liveState.gitData = gitData

    if (!data?.reports?.length && !mergedChecks?.reports?.length) {
      renderEmpty()
      return
    }
    renderDashboard(data ?? { reports: [], generatedAt: null }, mergedChecks, gitData)
  } catch (err) {
    console.error('[health-dashboard] render failure', err)
    renderError(err)
  }
}

function currentCommitHashes(section) {
  return [...section.querySelectorAll('[data-git-zone="commits"] .git-commit')]
    .map(el => el.dataset.hash).join('|')
}

async function refreshGitOnly() {
  const gitData = await fetchJson(GIT_URL)
  liveState.gitData = gitData
  const section = document.querySelector('[data-section="git"]')
  if (!section) return

  const tally = section.querySelector('[data-git-zone="tally"]')
  const folders = section.querySelector('[data-git-zone="folders"]')
  const commits = section.querySelector('[data-git-zone="commits"]')

  if (tally) tally.innerHTML = renderGitTally(gitData)
  if (folders) folders.innerHTML = renderGitFolders(gitData)

  const nextHashes = (gitData?.commits ?? []).map(c => c.hash).join('|')
  if (commits && nextHashes !== currentCommitHashes(section)) {
    commits.innerHTML = renderGitCommits(gitData)
  }

  if (gitData) section.classList.remove('is-error')
  else section.classList.add('is-error')
}

document.getElementById('btn-refresh')?.addEventListener('click', load)
setInterval(refreshGitOnly, GIT_POLL_MS)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshGitOnly()
})
load()
