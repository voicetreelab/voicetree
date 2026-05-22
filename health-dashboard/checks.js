import { esc, relTime, isStale, fmtDuration } from './format.js'
import { CHECK_TIERS, bucketizeByTier } from './checkTiers.js'

const CHECK_CATEGORY_ORDER = ['Command', 'Hook', 'Unit', 'Integration', 'E2E', 'Lint', 'TypeCheck', 'Static', 'Other']

const SLIDES = [
  { id: 'rows',  name: 'Compact rows' },
  { id: 'grid',  name: 'Dense grid' },
  { id: 'cards', name: 'Heatmap cards' },
]

function statusBadge(status) {
  if (status === 'pass') return `<span class="badge badge-pass">PASS</span>`
  if (status === 'fail') return `<span class="badge badge-fail">FAIL</span>`
  return `<span class="badge badge-skip">SKIP</span>`
}

function squareCls(c) {
  if (c.status === 'fail') return 'sq sq-fail'
  if (c.status === 'skip') return 'sq sq-skip'
  if (isStale(c.timestamp)) return 'sq sq-stale'
  return 'sq sq-pass'
}

function squareTooltip(c) {
  const head = `${c.checkName} — ${c.status.toUpperCase()}`
  if (c.testsTotal !== undefined) {
    const p = c.testsPassed ?? 0
    const f = c.testsFailed ?? 0
    const s = c.testsSkipped ?? 0
    return `${head}\n${p}/${c.testsTotal} tests · ${f} fail · ${s} skip`
  }
  return head
}

function renderSquare(c) {
  return `<button class="${squareCls(c)}" data-id="${esc(c.checkId)}" title="${esc(squareTooltip(c))}" type="button" aria-label="${esc(squareTooltip(c))}"></button>`
}

// fail → stale → pass → skip
function sortSquares(reports) {
  const rank = (r) => r.status === 'fail' ? 0 : isStale(r.timestamp) ? 1 : r.status === 'pass' ? 2 : 3
  return [...reports].sort((a, b) => rank(a) - rank(b) || a.checkId.localeCompare(b.checkId))
}

function categoryStats(reports) {
  const fail = reports.filter(r => r.status === 'fail').length
  const skip = reports.filter(r => r.status === 'skip').length
  const stale = reports.filter(r => r.status === 'pass' && isStale(r.timestamp)).length
  const pass = reports.length - fail - skip - stale
  return { fail, skip, pass, stale, total: reports.length }
}

function tallyChip(stats) {
  if (stats.total === 0) return `<span class="hm-tally is-skip">0 checks</span>`
  if (stats.fail > 0) return `<span class="hm-tally is-fail"><span class="t-fail">${stats.fail}</span>/${stats.total - stats.skip} failing</span>`
  if (stats.stale > 0) return `<span class="hm-tally is-stale">${stats.stale} stale · ${stats.pass} passing</span>`
  if (stats.pass === 0 && stats.skip === stats.total) return `<span class="hm-tally is-skip">all skipped</span>`
  return `<span class="hm-tally is-pass"><span class="t-pass">${stats.pass}</span>/${stats.total - stats.skip} passing</span>`
}

function bucketize(reports) {
  const byCategory = Object.fromEntries(CHECK_CATEGORY_ORDER.map(c => [c, []]))
  for (const r of reports) {
    const cat = CHECK_CATEGORY_ORDER.includes(r.category) ? r.category : 'Other'
    byCategory[cat].push(r)
  }
  return byCategory
}

function categoriesSortedWorstFirst(byCategory) {
  return CHECK_CATEGORY_ORDER
    .filter(c => byCategory[c].length > 0)
    .map(c => ({ name: c, reports: byCategory[c], stats: categoryStats(byCategory[c]) }))
    .sort((a, b) => b.stats.fail - a.stats.fail || b.stats.stale - a.stats.stale)
}

function renderCategoryRow(name, reports, stats) {
  const visible = sortSquares(reports.filter(r => r.status !== 'skip'))
  const skipPill = stats.skip > 0
    ? `<span class="hm-row-skip">+${stats.skip} skip</span>`
    : `<span class="hm-row-skip is-empty"></span>`
  return `<div class="hm-row" data-cat="${esc(name)}">
    <span class="hm-row-cat">${esc(name)}</span>
    <div class="hm-row-squares">${visible.map(renderSquare).join('')}</div>
    ${skipPill}
    ${tallyChip(stats)}
  </div>`
}

// ── Layout A: compact rows per category, skips folded to badge ──────────────
function renderRowsLayout(reports) {
  const byTier = bucketizeByTier(reports)
  const tiers = CHECK_TIERS.map((tier) => {
    const tierReports = byTier[tier.id]
    const tierStats = categoryStats(tierReports)
    const byCategory = bucketize(tierReports)
    const rows = categoriesSortedWorstFirst(byCategory)
      .map(({ name, reports: categoryReports, stats }) => renderCategoryRow(name, categoryReports, stats))
      .join('')
    const body = rows || `<div class="hm-tier-empty">no checks recorded</div>`
    return `<section class="hm-tier hm-${tier.id}" data-tier-id="${esc(tier.id)}">
      <div class="hm-tier-head">
        <div class="hm-tier-title">
          <span class="hm-tier-label">${esc(tier.label)}</span>
          <span class="hm-tier-scope">${esc(tier.scope)}</span>
          <span class="hm-tier-desc">${esc(tier.description)}</span>
        </div>
        ${tallyChip(tierStats)}
      </div>
      <div class="hm-tier-rows">${body}</div>
    </section>`
  }).join('')
  return `<div class="hm-rows">${tiers}</div>`
}

// ── Layout B: github-style dense grid, all checks visible, sorted per column
function renderGridLayout(byCategory) {
  const cats = categoriesSortedWorstFirst(byCategory)
  const cols = cats.map(({ name, reports }) => {
    const sorted = sortSquares(reports)
    return `<div class="hm-grid-col" data-cat="${esc(name)}">
      <div class="hm-grid-col-label">${esc(name)}</div>
      <div class="hm-grid-col-squares">${sorted.map(renderSquare).join('')}</div>
    </div>`
  }).join('')
  return `<div class="hm-grid">${cols}</div>`
}

// ── Layout C: per-category cards
function renderCardsLayout(byCategory) {
  const cats = categoriesSortedWorstFirst(byCategory)
  const cards = cats.map(({ name, reports, stats }) => {
    const visible = sortSquares(reports.filter(r => r.status !== 'skip'))
    const skipFoot = stats.skip > 0 ? `<div class="hm-card-skipped">+${stats.skip} skipped</div>` : ''
    return `<div class="hm-card" data-cat="${esc(name)}">
      <div class="hm-card-head">
        <span class="hm-card-name">${esc(name)}</span>
        ${tallyChip(stats)}
      </div>
      <div class="hm-card-squares">${visible.map(renderSquare).join('')}</div>
      ${skipFoot}
    </div>`
  }).join('')
  return `<div class="hm-cards">${cards}</div>`
}

function renderSlide(slide, byCategory) {
  if (slide.id === 'rows')  return renderRowsLayout(Object.values(byCategory).flat())
  if (slide.id === 'grid')  return renderGridLayout(byCategory)
  return renderCardsLayout(byCategory)
}

function renderCarousel(byCategory) {
  const slides = SLIDES.map((s, i) =>
    `<div class="hm-slide" data-i="${i}" data-id="${esc(s.id)}">${renderSlide(s, byCategory)}</div>`
  ).join('')
  const tabs = SLIDES.map((s, i) =>
    `<button type="button" class="hm-tab" data-i="${i}">${esc(s.name)}</button>`
  ).join('')
  return `<div class="hm-carousel" data-slide="0">
    <div class="hm-cs-bar">
      <button type="button" class="hm-cs-nav hm-cs-prev" aria-label="Previous layout">‹</button>
      <div class="hm-cs-tabs">${tabs}</div>
      <button type="button" class="hm-cs-nav hm-cs-next" aria-label="Next layout">›</button>
    </div>
    <div class="hm-viewport">
      <div class="hm-track" style="width:${SLIDES.length * 100}%">${slides}</div>
    </div>
    <div class="hm-detail" id="hm-detail" data-empty="1">
      <div class="hm-detail-empty">hover a square to inspect · click to pin · arrows / 1·2·3 to switch layout</div>
      <div class="hm-detail-body" hidden></div>
    </div>
    <div class="hm-legend">
      <span class="hm-legend-item"><span class="sq sq-fail" aria-hidden="true"></span> fail</span>
      <span class="hm-legend-item"><span class="sq sq-stale" aria-hidden="true"></span> stale</span>
      <span class="hm-legend-item"><span class="sq sq-pass" aria-hidden="true"></span> pass</span>
      <span class="hm-legend-item"><span class="sq sq-skip" aria-hidden="true"></span> skip</span>
    </div>
  </div>`
}

function overallTally(reports) {
  const stats = categoryStats(reports)
  const parts = []
  if (stats.fail > 0)  parts.push(`<span class="t-fail">${stats.fail} failing</span>`)
  if (stats.stale > 0) parts.push(`${stats.stale} stale`)
  parts.push(`<span class="t-pass">${stats.pass} passing</span>`)
  if (stats.skip > 0)  parts.push(`<span class="t-skip">${stats.skip} skipped</span>`)
  return `${reports.length} checks · ${parts.join(' · ')}`
}

export function renderChecksSection(checksData) {
  const reports = checksData?.reports ?? []
  if (reports.length === 0) {
    return `<section class="checks-section">
      <div class="category-header">
        <span class="category-name">CI / CD Checks</span>
        <span class="category-rule"></span>
        <span class="category-tally">no data</span>
      </div>
      <div class="checks-empty">
        <p>No CI check reports yet.</p>
        <p>Run <code>npm run test:t1</code> for the local push gate, or <code>npm run test:full</code> for every scheduled check.</p>
      </div>
    </section>`
  }

  const byCategory = bucketize(reports)

  return `<section class="checks-section">
    <div class="category-header">
      <span class="category-name">CI / CD Checks</span>
      <span class="category-rule"></span>
      <span class="category-tally">${overallTally(reports)}</span>
    </div>
    ${renderCarousel(byCategory)}
  </section>`
}

// ── Wiring: carousel + square interactivity ─────────────────────────────────
export function bindChecksSection(root, checksData) {
  const car = root.querySelector('.hm-carousel')
  if (!car) return
  const reports = checksData?.reports ?? []
  const byId = Object.fromEntries(reports.map(c => [c.checkId, c]))

  // ── Carousel
  const slides = car.querySelectorAll('.hm-slide')
  const tabs   = car.querySelectorAll('.hm-tab')
  const track  = car.querySelector('.hm-track')

  function setSlide(i) {
    const n = ((i % slides.length) + slides.length) % slides.length
    car.dataset.slide = String(n)
    if (track) track.style.transform = `translateX(-${(n * 100) / slides.length}%)`
    tabs.forEach((t, idx) => t.classList.toggle('is-active', idx === n))
  }

  car.querySelector('.hm-cs-prev')?.addEventListener('click', () => setSlide(Number(car.dataset.slide) - 1))
  car.querySelector('.hm-cs-next')?.addEventListener('click', () => setSlide(Number(car.dataset.slide) + 1))
  tabs.forEach(t => t.addEventListener('click', () => setSlide(Number(t.dataset.i))))

  // Keyboard within carousel
  car.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft')  { setSlide(Number(car.dataset.slide) - 1); e.preventDefault() }
    if (e.key === 'ArrowRight') { setSlide(Number(car.dataset.slide) + 1); e.preventDefault() }
    if (e.key === '1') setSlide(0)
    if (e.key === '2') setSlide(1)
    if (e.key === '3') setSlide(2)
  })

  setSlide(0)

  // ── Square hover / click → detail strip
  const detail     = car.querySelector('#hm-detail')
  const detailBody = detail.querySelector('.hm-detail-body')
  const detailHint = detail.querySelector('.hm-detail-empty')
  let pinned = null

  function renderDetail(c) {
    const measurePath = c.details?.measurePath ?? `packages/measures/${c.checkId}.ts`
    const counts = c.testsTotal !== undefined
      ? `<span><span class="t-pass">${c.testsPassed ?? 0}</span><span class="t-sep">/</span>${c.testsTotal} tests</span><span class="hm-d-sep">·</span><span class="t-fail">${c.testsFailed ?? 0} fail</span><span class="hm-d-sep">·</span><span class="t-skip">${c.testsSkipped ?? 0} skip</span>`
      : ''
    const errBlock = c.errorSummary
      ? `<pre class="hm-detail-error">${esc(c.errorSummary)}</pre>`
      : ''
    return `<div class="hm-detail-head">
        ${statusBadge(c.status)}
        <span class="hm-detail-name">${esc(c.checkName)}</span>
        <code class="hm-detail-cmd">${esc(c.command)}</code>
      </div>
      <div class="hm-detail-meta">
        ${counts}
        ${counts ? '<span class="hm-d-sep">·</span>' : ''}
        <span>${fmtDuration(c.durationMs)}</span>
        <span class="hm-d-sep">·</span>
        <time title="${esc(c.timestamp)}">${relTime(c.timestamp)}</time>
        <code class="hm-detail-source" title="Defined in this file">${esc(measurePath)}</code>
      </div>
      ${errBlock}`
  }

  function show(id) {
    const c = byId[id]
    if (!c) return
    detail.dataset.empty = '0'
    detailHint.hidden = true
    detailBody.hidden = false
    detailBody.innerHTML = renderDetail(c)
  }
  function clear() {
    if (pinned) return
    detail.dataset.empty = '1'
    detailHint.hidden = false
    detailBody.hidden = true
    detailBody.innerHTML = ''
    car.querySelectorAll('.sq.is-pinned').forEach(b => b.classList.remove('is-pinned'))
  }

  root.querySelectorAll('.sq[data-id]').forEach(btn => {
    btn.addEventListener('mouseenter', () => show(btn.dataset.id))
    btn.addEventListener('focus',      () => show(btn.dataset.id))
    btn.addEventListener('mouseleave', () => { if (!pinned) clear() })
    btn.addEventListener('blur',       () => { if (!pinned) clear() })
    btn.addEventListener('click', () => {
      if (pinned === btn.dataset.id) {
        pinned = null
        btn.classList.remove('is-pinned')
        clear()
      } else {
        car.querySelectorAll('.sq.is-pinned').forEach(b => b.classList.remove('is-pinned'))
        pinned = btn.dataset.id
        btn.classList.add('is-pinned')
        show(pinned)
      }
    })
  })
}
