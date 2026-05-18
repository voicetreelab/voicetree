// Click-to-expand the per-card explanation panel. Pure DOM toggle keyed off
// the `.card-info-btn` inside any `.metric-card`. Imported by app.js.

export function bindCardExplainToggles(root) {
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest?.('.card-info-btn')
    if (!btn) return
    ev.stopPropagation()
    const card = btn.closest('.metric-card')
    if (!card) return
    const panel = card.querySelector('.card-explain')
    if (!panel) return
    const isOpen = !panel.hidden
    if (isOpen) {
      panel.hidden = true
      card.classList.remove('is-explaining')
      btn.setAttribute('aria-expanded', 'false')
    } else {
      panel.hidden = false
      card.classList.add('is-explaining')
      btn.setAttribute('aria-expanded', 'true')
    }
  })
}
