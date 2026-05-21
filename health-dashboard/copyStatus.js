// Per-section "copy status" buttons. Each section header gets a small button
// that copies a plain-text summary of that section to clipboard, intended for
// pasting into an LLM/agent. Formatters are pure; binding reads live state
// through a getState() getter so git-poll refreshes pick up new data.

import { fmtNum, relTime } from './format.js'
import { CHECK_TIERS, bucketizeByTier } from './checkTiers.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMSS(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000)   return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

function utilization(r) {
  if (r.comparison === 'lte') {
    if (r.budget === 0) return r.current === 0 ? 0 : Infinity
    return r.current / r.budget
  }
  if (r.current === 0) return r.budget === 0 ? 0 : Infinity
  return r.budget / r.current
}

function utilStr(u) { return Number.isFinite(u) ? `${u.toFixed(2)}×` : '∞×' }

const isGate = (r) => r.budget === 0 && r.comparison === 'lte'

function metricLine(r) {
  const status = r.passed ? 'PASS' : 'FAIL'
  const cmp = r.comparison === 'lte' ? '≤' : '≥'
  const unit = r.unit ? ` ${r.unit}` : ''
  return `- [${status}] ${r.metricName}  ${fmtNum(r.current)}${unit} / ${cmp} ${fmtNum(r.budget)}${unit}`
}

// fail first, then by utilization desc
function sortMetrics(reports) {
  return [...reports].sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : -1
    return utilization(b) - utilization(a)
  })
}

// ── Section formatters ────────────────────────────────────────────────────────

export function formatGit(g) {
  if (!g) return `## Git Status\n(unavailable)`
  const lines = ['## Git Status']
  const head = [`branch ${g.branch}`]
  if (g.upstream?.hasUpstream) {
    head.push(g.upstream.ahead || g.upstream.behind
      ? `↑${g.upstream.ahead} ↓${g.upstream.behind}`
      : 'in sync')
  } else head.push('no upstream')
  const t = g.totals ?? { files: 0, adds: 0, dels: 0, untracked: 0 }
  if (t.files === 0) head.push('working tree clean')
  else {
    const diff = [
      `${t.files} file${t.files === 1 ? '' : 's'} dirty`,
      t.adds ? `+${t.adds}` : '',
      t.dels ? `−${t.dels}` : '',
      t.untracked ? `?${t.untracked} untracked` : '',
    ].filter(Boolean).join(' ')
    head.push(diff)
  }
  lines.push(head.join(' · '))

  if (g.dirtyFolders?.length) {
    lines.push('', `### Dirty folders (${g.dirtyFolders.length})`)
    for (const f of g.dirtyFolders) {
      const parts = [`${f.files} file${f.files === 1 ? '' : 's'}`]
      if (f.adds) parts.push(`+${f.adds}`)
      if (f.dels) parts.push(`−${f.dels}`)
      if (f.untracked) parts.push(`?${f.untracked}`)
      lines.push(`- ${f.folder}  ${parts.join(' ')}`)
    }
  }

  if (g.commits?.length) {
    lines.push('', `### Recent commits`)
    for (const c of g.commits) {
      lines.push(`- ${c.hash} — ${c.author}, ${relTime(c.iso)}`)
      lines.push(`  ${c.subject}`)
    }
  }
  return lines.join('\n')
}

export function formatWallClock(reports) {
  const timed = (reports ?? [])
    .filter(r => Number.isFinite(r.durationMs) && r.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs)
  if (timed.length === 0) return `## Wall Clock\n(no timed checks)`
  const total = timed.reduce((s, r) => s + r.durationMs, 0)
  const slow = timed.filter(r => r.durationMs >= 60_000).length
  const lines = [
    '## Wall Clock — slowest checks',
    `total ${fmtMSS(total)} · ${slow > 0 ? `${slow} over 1m` : 'all under 1m'} · ${timed.length} timed checks`,
    '',
  ]
  for (const r of timed) {
    const pct = ((r.durationMs / total) * 100).toFixed(0).padStart(3)
    const t = fmtMSS(r.durationMs).padStart(6)
    const stat = r.status === 'fail' ? '[FAIL]' : r.status === 'skip' ? '[SKIP]' : '[PASS]'
    lines.push(`- ${t}  ${pct}%  ${stat}  ${r.checkName}`)
  }
  return lines.join('\n')
}

const CHECK_CATEGORY_ORDER = ['Command', 'Hook', 'Unit', 'Integration', 'E2E', 'Lint', 'TypeCheck', 'Static', 'Other']

function appendCheckReports(lines, reports) {
  const byCat = new Map()
  for (const r of reports) {
    const cat = CHECK_CATEGORY_ORDER.includes(r.category) ? r.category : 'Other'
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat).push(r)
  }

  for (const cat of CHECK_CATEGORY_ORDER) {
    const arr = byCat.get(cat)
    if (!arr || arr.length === 0) continue
    lines.push('', `### ${cat}`)
    arr.sort((a, b) => {
      const rank = (r) => r.status === 'fail' ? 0 : r.status === 'skip' ? 2 : 1
      return rank(a) - rank(b) || a.checkId.localeCompare(b.checkId)
    })
    for (const r of arr) {
      const tag = r.status === 'fail' ? '[FAIL]' : r.status === 'skip' ? '[SKIP]' : '[PASS]'
      const dur = Number.isFinite(r.durationMs) ? `  ${fmtMSS(r.durationMs)}` : ''
      const tests = r.testsTotal !== undefined
        ? `  ${r.testsPassed ?? 0}/${r.testsTotal} tests${r.testsFailed ? ` · ${r.testsFailed} fail` : ''}`
        : ''
      lines.push(`- ${tag} ${r.checkId}${dur}${tests}`)
      lines.push(`  $ ${r.command}`)
      if (r.errorSummary) {
        const trimmed = r.errorSummary.trim().split('\n').slice(0, 4).join('\n    ')
        lines.push(`    err: ${trimmed}`)
      }
    }
  }
}

function checkTotalsLine(reports) {
  const fail = reports.filter(r => r.status === 'fail').length
  const skip = reports.filter(r => r.status === 'skip').length
  const pass = reports.length - fail - skip
  return `${reports.length} checks · ${fail} fail · ${pass} pass · ${skip} skip`
}

export function formatCheckTier(checksData, tierId) {
  const reports = checksData?.reports ?? []
  const tier = CHECK_TIERS.find(t => t.id === tierId)
  if (!tier) return `## CI / CD Checks\n(unknown tier: ${tierId})`
  const tierReports = bucketizeByTier(reports)[tierId] ?? []
  const lines = [
    `## CI / CD Checks — ${tier.label}`,
    `${tier.scope} · ${tier.description}`,
    checkTotalsLine(tierReports),
  ]
  appendCheckReports(lines, tierReports)
  if (checksData?.generatedAt) {
    lines.push('', `Captured ${relTime(checksData.generatedAt)}`)
  }
  return lines.join('\n')
}

export function formatChecks(checksData) {
  const reports = checksData?.reports ?? []
  if (reports.length === 0) {
    return `## CI / CD Checks\n(no data — run \`npm run measures:capture-ci\`)`
  }
  const lines = [
    '## CI / CD Checks',
    checkTotalsLine(reports),
  ]

  appendCheckReports(lines, reports)
  if (checksData?.generatedAt) {
    lines.push('', `Captured ${relTime(checksData.generatedAt)}`)
  }
  return lines.join('\n')
}

export function formatGates(gates) {
  if (!gates || gates.length === 0) return `## Pass / Fail Gates\n(no gates)`
  const pass = gates.filter(r => r.passed).length
  const fail = gates.length - pass
  const lines = [
    '## Pass / Fail Gates',
    `${pass}/${gates.length} passing${fail > 0 ? ` · ${fail} failing` : ''}`,
    '',
  ]
  for (const r of sortMetrics(gates)) {
    const status = r.passed ? '[PASS]' : '[FAIL]'
    lines.push(`- ${status} ${r.metricName}  current ${fmtNum(r.current)}`)
  }
  return lines.join('\n')
}

export function formatMetricGroup(title, reports, note) {
  if (!reports || reports.length === 0) return `## ${title}\n(no metrics)`
  const pass = reports.filter(r => r.passed).length
  const fail = reports.length - pass
  const lines = [
    `## ${title}`,
    `${pass}/${reports.length} passing${fail > 0 ? ` · ${fail} failing` : ''}`,
  ]
  if (note) lines.push(`note: ${note}`)
  lines.push('')
  for (const r of sortMetrics(reports)) lines.push(metricLine(r))
  return lines.join('\n')
}

export function formatRanking(reports) {
  const scored = (reports ?? []).filter(r => !isGate(r))
  if (scored.length === 0) return `## Metric Ranking\n(no scored metrics)`
  const fail = scored.filter(r => !r.passed).length
  const lines = [
    '## Metric Ranking — Worst First',
    `${scored.length} scored metrics${fail > 0 ? ` · ${fail} failing` : ''}`,
    '',
  ]
  const ranked = [...scored].sort((a, b) => utilization(b) - utilization(a))
  for (const r of ranked) {
    const u = utilization(r)
    const status = r.passed ? '[PASS]' : '[FAIL]'
    const cmp = r.comparison === 'lte' ? '≤' : '≥'
    lines.push(`- ${utilStr(u).padStart(6)} ${status} ${r.metricName}  ${fmtNum(r.current)} / ${cmp} ${fmtNum(r.budget)}`)
  }
  return lines.join('\n')
}

// Lightweight flag harvesting — mirrors fileTree.js's extractor for the purpose
// of generating a top-folder summary. Kept local to avoid coupling.
function harvestFlagPaths(reports) {
  const flags = []
  const seen = new Set()
  const strip = (p) => {
    if (typeof p !== 'string') return null
    const m = '/voicetree-public/'
    const i = p.indexOf(m)
    return i >= 0 ? p.slice(i + m.length) : p
  }
  const valid = (p) => typeof p === 'string' && p && !p.startsWith('/')
  for (const r of reports ?? []) {
    const d = r.details
    if (!d || typeof d !== 'object') continue
    const src = []
    if (Array.isArray(d.violations)) {
      for (const v of d.violations) src.push(v?.file ?? v?.directory)
    }
    if (Array.isArray(d.topFiles)) for (const f of d.topFiles) src.push(f?.file)
    for (const k of ['topFunctions', 'topLongestFunctions', 'longestFunctions', 'findings', 'functions', 'largestFiles']) {
      if (Array.isArray(d[k])) for (const f of d[k]) src.push(f?.file)
    }
    if (Array.isArray(d.topPriority)) {
      for (const p of d.topPriority) {
        const id = p?.community?.id
        if (typeof id === 'string') src.push(`packages/systems/${id}`)
      }
    }
    for (const raw of src) {
      const p = strip(raw)
      if (!valid(p)) continue
      const key = `${r.metricId}|${p}`
      if (seen.has(key)) continue
      seen.add(key)
      flags.push({ path: p, metricId: r.metricId, metricName: r.metricName, fromFailing: !r.passed })
    }
  }
  return flags
}

export function formatFileTree(reports) {
  const flags = harvestFlagPaths(reports)
  if (flags.length === 0) return `## Unhealthy Folders\n(no per-file violations recorded)`

  // Group by first 3 path segments (typical "package/area/subarea" granularity).
  const byFolder = new Map()
  for (const f of flags) {
    const segs = f.path.split('/').filter(Boolean)
    const key = segs.slice(0, Math.min(3, segs.length)).join('/')
    let g = byFolder.get(key)
    if (!g) { g = { flags: [], metrics: new Set() }; byFolder.set(key, g) }
    g.flags.push(f)
    g.metrics.add(f.metricId)
  }
  const folders = [...byFolder.entries()].map(([folder, g]) => {
    const debt = g.flags.reduce((s, f) => s + (f.fromFailing ? 3 : 1), 0)
              + Math.max(0, g.metrics.size - 1)
    return { folder, debt, flags: g.flags.length, metrics: g.metrics.size }
  }).sort((a, b) => b.debt - a.debt)

  const totalDebt = folders.reduce((s, f) => s + f.debt, 0)
  const allMetrics = new Set(flags.map(f => f.metricId))

  const lines = [
    '## Unhealthy Folders',
    `debt ${totalDebt} · ${flags.length} flags · ${folders.length} folders · ${allMetrics.size} metrics`,
    '',
  ]
  const SHOW = 20
  for (const f of folders.slice(0, SHOW)) {
    lines.push(`- ${f.folder}  debt ${f.debt}  ${f.flags} flag${f.flags === 1 ? '' : 's'}  ${f.metrics} metric${f.metrics === 1 ? '' : 's'}`)
  }
  if (folders.length > SHOW) lines.push(`...and ${folders.length - SHOW} more folders`)
  return lines.join('\n')
}

export function formatTreemap(reports) {
  const data = reports ?? []
  if (data.length === 0) return `## Hierarchy Treemap\n(no metrics)`
  const fail = data.filter(r => !r.passed)
  const caution = data.filter(r => {
    if (!r.passed) return false
    const u = utilization(r)
    return Number.isFinite(u) && u >= 0.85
  })
  const lines = [
    '## Hierarchy Treemap',
    `${data.length} metrics · ${fail.length} failing · ${caution.length} caution (≥85%)`,
  ]
  if (fail.length > 0) {
    lines.push('', '### Failing')
    for (const r of sortMetrics(fail)) {
      const u = utilization(r)
      const cmp = r.comparison === 'lte' ? '≤' : '≥'
      lines.push(`- ${utilStr(u)} ${r.metricName}  ${fmtNum(r.current)} / ${cmp} ${fmtNum(r.budget)}`)
    }
  }
  if (caution.length > 0) {
    lines.push('', '### Caution (≥85% of budget)')
    for (const r of sortMetrics(caution)) {
      const u = utilization(r)
      const cmp = r.comparison === 'lte' ? '≤' : '≥'
      lines.push(`- ${utilStr(u)} ${r.metricName}  ${fmtNum(r.current)} / ${cmp} ${fmtNum(r.budget)}`)
    }
  }
  return lines.join('\n')
}

// ── Button injection + clipboard binding ──────────────────────────────────────

const BTN_HTML = `<button class="copy-btn" type="button" aria-label="Copy section status to clipboard"><span class="copy-btn-text">copy</span></button>`

// execCommand-based fallback for when navigator.clipboard.writeText is blocked
// (e.g. document not focused). Creates a transient textarea, selects + copies,
// then removes it. Returns true on success.
function execCopyFallback(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  document.body.removeChild(ta)
  return ok
}

async function doCopy(btn, text) {
  const label = btn.querySelector('.copy-btn-text')
  const restore = (cls) => setTimeout(() => {
    btn.classList.remove(cls)
    if (label) label.textContent = 'copy'
  }, 1400)
  let ok = false
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch {
    ok = execCopyFallback(text)
  }
  if (ok) {
    btn.classList.add('is-copied')
    if (label) label.textContent = 'copied'
    restore('is-copied')
  } else {
    btn.classList.add('is-error')
    if (label) label.textContent = 'failed'
    restore('is-error')
  }
}

function injectAt(section, headerSel, getText) {
  if (!section) return
  const header = section.querySelector(headerSel)
  if (!header) return
  if (header.querySelector(':scope > .copy-btn')) return
  header.insertAdjacentHTML('beforeend', BTN_HTML)
  const btn = header.querySelector(':scope > .copy-btn')
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    doCopy(btn, getText())
  })
}

// getState() returns { reports, checksData, gitData, axisDefs, categoryOrder }
export function bindCopyButtons(main, getState) {
  // Git
  injectAt(main.querySelector('.git-section'), '.category-header',
    () => formatGit(getState().gitData))

  // Wall Clock
  injectAt(main.querySelector('.wc-panel'), '.wc-head',
    () => formatWallClock(getState().checksData?.reports ?? []))

  // CI / CD Checks
  injectAt(main.querySelector('.checks-section'), '.category-header',
    () => formatChecks(getState().checksData))
  for (const tierEl of main.querySelectorAll('.checks-section .hm-tier')) {
    const tierId = tierEl.dataset.tierId
    injectAt(tierEl, '.hm-tier-head', () => formatCheckTier(getState().checksData, tierId))
  }

  // Pass / Fail Gates
  injectAt(main.querySelector('.gates-section'), '.category-header',
    () => formatGates((getState().reports ?? []).filter(isGate)))

  // Axes
  for (const axisEl of main.querySelectorAll('.axis-section')) {
    const axisName = axisEl.dataset.axis
    const note = axisEl.querySelector('.axis-note')?.textContent ?? ''
    injectAt(axisEl, '.axis-header', () => {
      const def = (getState().axisDefs ?? []).find(a => a.name === axisName)
      const items = def ? (getState().reports ?? []).filter(def.match) : []
      return formatMetricGroup(`${axisName} axis`, items, note)
    })
  }

  // Unhealthy Folders
  injectAt(main.querySelector('.filetree-section'), '.category-header',
    () => formatFileTree(getState().reports ?? []))

  // Hierarchy Treemap
  injectAt(main.querySelector('.treemap-section'), '.category-header',
    () => formatTreemap(getState().reports ?? []))

  // Ranking
  injectAt(main.querySelector('.ranking-section'), '.category-header',
    () => formatRanking(getState().reports ?? []))

  // Categories (Coupling, Complexity, etc.) — exclude metrics already grouped under an axis
  for (const catEl of main.querySelectorAll('.category-section')) {
    const catName = catEl.dataset.cat
    injectAt(catEl, '.category-header', () => {
      const state = getState()
      const reports = state.reports ?? []
      const order = state.categoryOrder ?? []
      const inAxis = new Set()
      for (const a of state.axisDefs ?? []) {
        for (const r of reports.filter(a.match)) inAxis.add(r.metricId)
      }
      const items = reports.filter(r => {
        const cat = order.includes(r.category) ? r.category : 'Other'
        return cat === catName && !inAxis.has(r.metricId)
      })
      return formatMetricGroup(catName, items)
    })
  }
}
