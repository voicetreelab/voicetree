import { chromium } from 'playwright-core'

const b = await chromium.connectOverCDP('http://localhost:9234')
const page = b.contexts()[0].pages()[0]

const consoleLines = []
page.on('console', (msg) => { consoleLines.push(`[${msg.type()}] ${msg.text()}`) })
page.on('pageerror', (err) => { consoleLines.push(`[pageerror] ${err.message}`) })

// Target: same first-sorted node
const pre = await page.evaluate(() => {
  const cy = window.cytoscapeInstance
  const n = cy.nodes().toArray().sort((a, b) => a.id().localeCompare(b.id()))[0]
  return { id: n.id(), rendered: n.renderedPosition(), cyCount: cy.nodes().length }
})
console.log('pre:', JSON.stringify(pre))

// Tap node to mount editor
await page.mouse.click(pre.rendered.x, pre.rendered.y)
await page.waitForTimeout(500)

// Deep inspect the "Add Child" button
const probe = await page.evaluate(() => {
  const editors = Array.from(document.querySelectorAll('[id^="window-"][id$="-editor"]'))
  let target = null
  for (const ed of editors) {
    const btns = Array.from(ed.querySelectorAll('button'))
    for (const btn of btns) {
      const title = btn.getAttribute('title') || ''
      if (/add child/i.test(title) && btn.getBoundingClientRect().width > 0) {
        target = { editor: ed, btn }
        break
      }
    }
    if (target) break
  }
  if (!target) return { error: 'no add child button visible' }

  const { btn } = target
  const r = btn.getBoundingClientRect()

  // What element is at that pixel?
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const topElAtPoint = document.elementFromPoint(cx, cy)
  const chain = []
  let el = topElAtPoint
  let depth = 0
  while (el && depth < 10) {
    chain.push({ tag: el.tagName, cls: el.className?.toString?.().slice(0, 80), id: el.id?.slice(0, 60), title: el.getAttribute?.('title') })
    el = el.parentElement
    depth++
  }

  const cs = getComputedStyle(btn)
  // Collect pointer-events / z-index for button + ancestors
  const ancestors = []
  let a = btn
  let d = 0
  while (a && d < 6) {
    const s = getComputedStyle(a)
    ancestors.push({
      tag: a.tagName, cls: (a.className?.toString?.() || '').slice(0, 80), id: (a.id || '').slice(0, 60),
      pointerEvents: s.pointerEvents, zIndex: s.zIndex, position: s.position, opacity: s.opacity,
    })
    a = a.parentElement
    d++
  }

  return {
    btnRect: { x: r.x, y: r.y, w: r.width, h: r.height, cx, cy },
    btnStyle: { display: cs.display, visibility: cs.visibility, pointerEvents: cs.pointerEvents, zIndex: cs.zIndex, opacity: cs.opacity },
    topElAtPoint: { tag: topElAtPoint?.tagName, cls: topElAtPoint?.className?.toString?.().slice(0, 120), title: topElAtPoint?.getAttribute?.('title') },
    chain,
    ancestors,
    btnEqualsTopEl: btn === topElAtPoint,
  }
})
console.log('probe:', JSON.stringify(probe, null, 2))

// Try programmatic .click() directly on the button (bypass hit-test)
const directClick = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => {
    const r = b.getBoundingClientRect()
    return (b.getAttribute('title') || '').match(/add child/i) && r.width > 0
  })
  if (!btn) return { error: 'no btn' }
  const before = window.cytoscapeInstance.nodes().length
  btn.click()
  return { before, clicked: true }
})
console.log('direct click:', JSON.stringify(directClick))

await page.waitForTimeout(1500)
const afterDirect = await page.evaluate(() => ({
  cyCount: window.cytoscapeInstance.nodes().length,
  editors: Array.from(document.querySelectorAll('[id^="window-"][id$="-editor"]')).length,
}))
console.log('after direct click:', JSON.stringify(afterDirect))

console.log('\n=== CONSOLE ===')
for (const l of consoleLines.slice(-40)) console.log(l)

await b.close()
