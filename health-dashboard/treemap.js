import { esc } from './format.js'
import { buildHierarchy, collectLeaves } from './treemap-hierarchy.js'
import { renderTreemapSvg } from './treemap-render.js'

export function renderTreemapSection (reports) {
  const data = reports ?? []
  if (data.length === 0) {
    return `<section class="treemap-section">
      <div class="category-header">
        <span class="category-name">Hierarchy Treemap</span>
        <span class="category-rule"></span>
        <span class="category-tally">no metrics</span>
      </div>
    </section>`
  }
  const categories = buildHierarchy(data)
  const total = categories.reduce((s, c) => s + collectLeaves(c).length, 0)
  const fail  = categories.filter((c) => !c.passed).length
  const tally = fail > 0
    ? `${categories.length} cats · ${total} metrics · <span class="t-fail">${fail} failing</span>`
    : `${categories.length} cats · ${total} metrics`
  const svg = renderTreemapSvg(categories, 'util')

  return `<section class="treemap-section" data-mode="util">
    <div class="category-header">
      <span class="category-name">Hierarchy Treemap</span>
      <span class="category-rule"></span>
      <span class="category-tally">${tally}</span>
      <div class="tm-mode" role="tablist" aria-label="Treemap sizing mode">
        <button type="button" class="tm-mode-btn is-active" data-mode="util" role="tab" aria-selected="true">size · utilization</button>
        <button type="button" class="tm-mode-btn"           data-mode="count" role="tab" aria-selected="false">size · count</button>
      </div>
    </div>
    <p class="tm-help">
      Each leaf is one metric. <strong>Area</strong> = utilization (current ÷ budget, capped at 2×) with a 0.18 floor so passing-budget metrics stay visible. <strong>Colour</strong> = pass / caution / fail / gate. Categories → subgroups → leaves are all sorted worst-first.
    </p>
    <div class="tm-canvas" data-categories="${categories.length}">${svg}</div>
    <div class="tm-tooltip" hidden></div>
    <div class="tm-legend">
      <span class="tm-legend-item tm-legend-fail"><span class="tm-swatch"></span>fail</span>
      <span class="tm-legend-item tm-legend-caution"><span class="tm-swatch"></span>caution · ≥85% of budget</span>
      <span class="tm-legend-item tm-legend-pass"><span class="tm-swatch"></span>pass</span>
      <span class="tm-legend-item tm-legend-gate"><span class="tm-swatch"></span>gate · budget = 0</span>
    </div>
  </section>`
}

export function bindTreemapSection (root, reports) {
  const section = root.querySelector('.treemap-section')
  if (!section) return
  const canvas  = section.querySelector('.tm-canvas')
  const tooltip = section.querySelector('.tm-tooltip')
  const buttons = section.querySelectorAll('.tm-mode-btn')
  const categories = buildHierarchy(reports ?? [])

  const moveTooltip = (e) => {
    const rect = section.getBoundingClientRect()
    const ttRect = tooltip.getBoundingClientRect()
    const x = e.clientX - rect.left + 14
    const y = e.clientY - rect.top + 14
    tooltip.style.left = `${Math.max(0, Math.min(x, rect.width  - ttRect.width  - 6))}px`
    tooltip.style.top  = `${Math.max(0, Math.min(y, rect.height - ttRect.height - 6))}px`
  }

  const showTooltip = (e, g) => {
    const d = g.dataset
    const cmp = d.cmp === 'lte' ? '≤' : '≥'
    const unitTxt = d.unit ? ` ${d.unit}` : ''
    tooltip.innerHTML = `
      <div class="tm-tt-head">
        <span class="tm-tt-status tm-status-${esc(d.status)}">${esc(d.status)}</span>
        <span class="tm-tt-name">${esc(d.name)}</span>
      </div>
      <div class="tm-tt-row"><span class="tm-tt-lbl">current</span><span class="tm-tt-val">${esc(d.current)}${esc(unitTxt)}</span></div>
      <div class="tm-tt-row"><span class="tm-tt-lbl">budget</span><span class="tm-tt-val">${esc(cmp)} ${esc(d.budget)}${esc(unitTxt)}</span></div>
      <div class="tm-tt-row"><span class="tm-tt-lbl">utilization</span><span class="tm-tt-val">${esc(d.util)}</span></div>
      <div class="tm-tt-id">${esc(d.id)}</div>`
    tooltip.hidden = false
    moveTooltip(e)
  }

  const hideTooltip = () => { tooltip.hidden = true }

  const bindLeafEvents = () => {
    canvas.querySelectorAll('.tm-leaf').forEach((g) => {
      g.addEventListener('mouseenter', (e) => showTooltip(e, g))
      g.addEventListener('mousemove',  moveTooltip)
      g.addEventListener('mouseleave', hideTooltip)
    })
  }

  const rerender = (mode) => {
    section.dataset.mode = mode
    canvas.innerHTML = renderTreemapSvg(categories, mode)
    bindLeafEvents()
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode
      if (section.dataset.mode === mode) return
      buttons.forEach((b) => {
        const active = b === btn
        b.classList.toggle('is-active', active)
        b.setAttribute('aria-selected', String(active))
      })
      rerender(mode)
    })
  })

  bindLeafEvents()
}
