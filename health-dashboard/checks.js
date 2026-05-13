import { esc, relTime, isStale, fmtDuration } from './format.js'

const CHECK_CATEGORY_ORDER = ['Unit', 'Integration', 'E2E', 'Lint', 'TypeCheck', 'Static', 'Other']

function statusBadge(status) {
  if (status === 'pass') return `<span class="badge badge-pass">PASS</span>`
  if (status === 'fail') return `<span class="badge badge-fail">FAIL</span>`
  return `<span class="badge badge-skip">SKIP</span>`
}

function renderCheckBar(c) {
  if (c.testsTotal === undefined || c.testsTotal === 0) return ''
  const passed = c.testsPassed ?? 0
  const failed = c.testsFailed ?? 0
  const skipped = c.testsSkipped ?? 0
  const total = Math.max(c.testsTotal, passed + failed + skipped)
  const pct = (n) => `${(n / total) * 100}%`
  return `<div class="check-bar" role="img" aria-label="${passed} passed, ${failed} failed, ${skipped} skipped of ${total}">
    <div class="check-bar-pass" style="width:${pct(passed)}"></div>
    <div class="check-bar-fail" style="width:${pct(failed)}"></div>
    <div class="check-bar-skip" style="width:${pct(skipped)}"></div>
  </div>`
}

function renderCheckCounts(c) {
  if (c.testsTotal === undefined) return `<span class="check-row-counts is-empty">—</span>`
  const passed = c.testsPassed ?? 0
  return `<span class="check-row-counts">
    <span class="check-counts-text"><span class="t-pass">${passed}</span><span class="t-sep">/</span>${c.testsTotal}</span>
    ${renderCheckBar(c)}
  </span>`
}

function renderCheckRow(c) {
  const stale = isStale(c.timestamp)
  const cls = c.status === 'fail' ? 'is-fail' : c.status === 'skip' ? 'is-skip' : stale ? 'is-stale' : ''
  const errorBlock = c.status === 'fail' && c.errorSummary
    ? `<button class="check-row-toggle" type="button" aria-expanded="false" aria-label="Toggle error details">▾</button>
       <pre class="check-row-error" hidden>${esc(c.errorSummary)}</pre>`
    : ''
  const slowTag = c.slow ? `<span class="check-tag slow" title="Long-running — skipped under --quick">slow</span>` : ''
  const source = `scripts/measures/${c.checkId}.ts`
  return `<li class="check-row ${cls}" data-id="${esc(c.checkId)}" data-status="${esc(c.status)}">
    ${statusBadge(c.status)}
    <div class="check-row-meta">
      <div class="check-row-name">${esc(c.checkName)}${slowTag}</div>
      <code class="check-row-cmd">${esc(c.command)}</code>
      <code class="check-row-source" title="Defined in this file — edit or copy to add a new check">${esc(source)}</code>
    </div>
    ${renderCheckCounts(c)}
    <span class="check-row-duration">${fmtDuration(c.durationMs)}</span>
    <time class="check-row-time" title="${esc(c.timestamp)}">${relTime(c.timestamp)}</time>
    ${errorBlock}
  </li>`
}

function catTallySummary(reports) {
  const pass  = reports.filter(r => r.status === 'pass').length
  const skip  = reports.filter(r => r.status === 'skip').length
  const total = reports.length

  let countsText = ''
  const tested = reports.filter(r => r.testsTotal !== undefined)
  if (tested.length > 0) {
    const totalTests = tested.reduce((s, r) => s + (r.testsTotal ?? 0), 0)
    const p          = tested.reduce((s, r) => s + (r.testsPassed ?? 0), 0)
    const f          = tested.reduce((s, r) => s + (r.testsFailed ?? 0), 0)
    countsText = `  ·  total ${totalTests} tests, <span class="t-pass">${p} passed</span>${f > 0 ? `, <span class="t-fail">${f} failed</span>` : ''}`
  }

  const failed = total - pass - skip
  const passingLine = failed > 0
    ? `<span class="t-pass">${pass}</span> / <span class="t-fail">${total - skip}</span>`
    : `<span class="t-pass">${pass}</span> / ${total - skip}`
  const skipNote = skip > 0 ? ` <span class="t-skip">(${skip} skip)</span>` : ''
  return `${passingLine} passing${skipNote}${countsText}`
}

function renderCheckCategory(name, reports) {
  return `<section class="check-cat-group" data-cat="${esc(name)}">
    <div class="check-cat-head">
      <span class="check-cat-name">${esc(name)}</span>
      <span class="check-cat-rule"></span>
      <span class="check-cat-tally">${catTallySummary(reports)}</span>
    </div>
    <ul class="check-rows">${reports.map(renderCheckRow).join('')}</ul>
  </section>`
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
        <p>Run <code>npm run health:capture-ci</code> to populate, or <code>npm run health:capture-ci -- --quick</code> to skip slow checks.</p>
      </div>
    </section>`
  }

  const byCategory = Object.fromEntries(CHECK_CATEGORY_ORDER.map(c => [c, []]))
  for (const c of reports) {
    const cat = CHECK_CATEGORY_ORDER.includes(c.category) ? c.category : 'Other'
    byCategory[cat].push(c)
  }

  const groups = CHECK_CATEGORY_ORDER
    .filter(c => byCategory[c].length > 0)
    .map(c => renderCheckCategory(c, byCategory[c]))
    .join('')

  return `<section class="checks-section">
    <div class="category-header">
      <span class="category-name">CI / CD Checks</span>
      <span class="category-rule"></span>
      <span class="category-tally">${catTallySummary(reports)}</span>
    </div>
    <div class="check-groups">${groups}</div>
  </section>`
}

export function bindCheckToggles(root) {
  for (const btn of root.querySelectorAll('.check-row-toggle')) {
    btn.addEventListener('click', () => {
      const row = btn.closest('.check-row')
      const pre = row.querySelector('.check-row-error')
      const open = !pre.hasAttribute('hidden')
      if (open) {
        pre.setAttribute('hidden', '')
        btn.setAttribute('aria-expanded', 'false')
        btn.textContent = '▾'
      } else {
        pre.removeAttribute('hidden')
        btn.setAttribute('aria-expanded', 'true')
        btn.textContent = '▴'
      }
    })
  }
}
