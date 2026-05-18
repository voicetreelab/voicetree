// Binary pass/fail gates section (budget 0, comparison lte). Renders a
// collapsible row of chips with localStorage-persisted shown/hidden state.

import { esc, fmtNum, isStale } from './format.js'

const GATES_SHOWN_KEY = 'health-dashboard:gates-shown'

export const isGate = (r) => r.budget === 0 && r.comparison === 'lte'

export function gatesShown() {
  try { return localStorage.getItem(GATES_SHOWN_KEY) === '1' } catch { return false }
}
function setGatesShown(v) {
  try { localStorage.setItem(GATES_SHOWN_KEY, v ? '1' : '0') } catch {}
}

function renderGateChip(r) {
  const stale = isStale(r.timestamp)
  const cls = stale ? 'is-stale' : r.passed ? 'is-pass' : 'is-fail'
  const icon = stale ? '⚠' : r.passed ? '✓' : '✗'
  const unit = r.unit ? ` ${esc(r.unit)}` : ''
  const titleBits = [
    r.metricName,
    r.description,
    `current: ${fmtNum(r.current)}${unit}   budget: ≤ ${fmtNum(r.budget)}${unit}`,
    `last run: ${r.timestamp}`,
  ].filter(Boolean)
  return `<span class="gate-chip ${cls}" data-id="${esc(r.metricId)}" title="${esc(titleBits.join('\n'))}">
    <span class="gate-chip-icon" aria-hidden="true">${icon}</span>
    <span class="gate-chip-name">${esc(r.metricName)}</span>
    ${r.passed || stale ? '' : `<span class="gate-chip-count">${fmtNum(r.current)}</span>`}
  </span>`
}

export function renderGatesSection(gates, shown) {
  if (gates.length === 0) return ''
  const pass = gates.filter(r => r.passed).length
  const fail = gates.length - pass
  const tally = fail > 0
    ? `<span class="t-pass">${pass}</span> / <span class="t-fail">${gates.length}</span>`
    : `<span class="t-pass">${pass}</span> / ${gates.length}`
  return `<section class="gates-section" data-shown="${shown ? '1' : '0'}">
    <div class="category-header">
      <span class="category-name">Pass / Fail Gates</span>
      <span class="category-rule"></span>
      <span class="category-tally">${tally} passing</span>
      <button class="btn-toggle-gates" id="btn-toggle-gates" type="button" aria-pressed="${shown}">${shown ? 'hide' : 'show'}</button>
    </div>
    <div class="gates-body" ${shown ? '' : 'hidden'}>
      <p class="gates-help">Binary gates with budget 0. ✓ means zero violations — these can't rank on the bar chart because their utilization is always 0× (pass) or ∞× (fail).</p>
      <div class="gate-chips">${gates.map(renderGateChip).join('')}</div>
    </div>
  </section>`
}

export function bindGatesToggle(root) {
  const btn = root.querySelector('#btn-toggle-gates')
  if (!btn) return
  btn.addEventListener('click', () => {
    const next = !gatesShown()
    setGatesShown(next)
    const section = btn.closest('.gates-section')
    const body = section?.querySelector('.gates-body')
    if (!section || !body) return
    section.dataset.shown = next ? '1' : '0'
    btn.textContent = next ? 'hide' : 'show'
    btn.setAttribute('aria-pressed', String(next))
    if (next) body.removeAttribute('hidden'); else body.setAttribute('hidden', '')
  })
}
