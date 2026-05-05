import { chromium } from 'playwright-core'
import fs from 'node:fs'

const b = await chromium.connectOverCDP('http://localhost:9234')
const page = b.contexts()[0].pages()[0]
console.log('url:', page.url())

const live = await page.evaluate(() => {
  const cy = window.cytoscapeInstance
  if (!cy) return { error: 'no live cy' }
  const nodes = cy.nodes()
  const out = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const rp = n.renderedPosition()
    const bb = n.renderedBoundingBox()
    out.push({ id: n.id(), rendered: rp, bb, hidden: n.hidden(), classes: n.classes() })
  }
  return { count: nodes.length, nodes: out, viewport: { zoom: cy.zoom(), pan: cy.pan() } }
})
console.log('live cy:', JSON.stringify(live, null, 2))

if (live.count > 0) {
  const target = live.nodes[0]
  // Probe before
  const before = await page.evaluate(() => ({
    floatingEditors: document.querySelectorAll('[id^="window-"][id$="-editor"]').length,
    floatingWrappers: document.querySelectorAll('.floating-editor-wrapper').length,
    selected: window.cytoscapeInstance?.$(':selected').map(n => n.id()) ?? []
  }))
  console.log('before:', JSON.stringify(before))

  await page.screenshot({ path: '/tmp/vt-debug/aki-repro/before-click.png', fullPage: true })

  // STRATEGY 1: emit('tap') programmatically
  const emitResult = await page.evaluate((id) => {
    const cy = window.cytoscapeInstance
    const n = cy.getElementById(id)
    if (!n || n.length === 0) return { error: 'node not found' }
    // emit a tap event with the node as target
    n.emit('tap')
    return { emitted: true }
  }, target.id)
  console.log('emit:', JSON.stringify(emitResult))
  await page.waitForTimeout(600)

  const afterEmit = await page.evaluate(() => ({
    floatingEditors: document.querySelectorAll('[id^="window-"][id$="-editor"]').length,
    floatingWrappers: document.querySelectorAll('.floating-editor-wrapper').length,
    selected: window.cytoscapeInstance?.$(':selected').map(n => n.id()) ?? [],
    allWindowIds: Array.from(document.querySelectorAll('[id^="window-"]')).map(e => e.id)
  }))
  console.log('after emit("tap"):', JSON.stringify(afterEmit))

  await page.screenshot({ path: '/tmp/vt-debug/aki-repro/after-emit-tap.png', fullPage: true })

  // STRATEGY 2: real mouse click at node rendered position
  const cx = target.rendered.x
  const cy_ = target.rendered.y
  console.log(`real click at (${cx}, ${cy_})`)
  await page.mouse.click(cx, cy_)
  await page.waitForTimeout(600)

  const afterClick = await page.evaluate(() => ({
    floatingEditors: document.querySelectorAll('[id^="window-"][id$="-editor"]').length,
    floatingWrappers: document.querySelectorAll('.floating-editor-wrapper').length,
    selected: window.cytoscapeInstance?.$(':selected').map(n => n.id()) ?? [],
    allWindowIds: Array.from(document.querySelectorAll('[id^="window-"]')).map(e => e.id)
  }))
  console.log('after real mouse click:', JSON.stringify(afterClick))
  await page.screenshot({ path: '/tmp/vt-debug/aki-repro/after-click.png', fullPage: true })
}

await b.close()
