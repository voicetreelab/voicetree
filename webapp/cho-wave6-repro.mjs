import { chromium } from 'playwright-core'

const b = await chromium.connectOverCDP('http://localhost:9234')
const page = b.contexts()[0].pages()[0]
console.log('url:', page.url())

const consoleLines = []
page.on('console', (msg) => { consoleLines.push(`[${msg.type()}] ${msg.text()}`) })
page.on('pageerror', (err) => { consoleLines.push(`[pageerror] ${err.message}`) })

// If project picker is shown, click example_small
const hasCy = await page.evaluate(() => !!window.cytoscapeInstance)
if (!hasCy) {
  console.log('no cy instance — clicking example_small project button')
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('example_small'))
    if (!btn) return { error: 'no example_small button' }
    btn.click()
    return { clicked: true }
  })
  console.log('project picker click:', JSON.stringify(clicked))
  // Wait for cytoscape to mount
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500)
    const ready = await page.evaluate(() => !!window.cytoscapeInstance && window.cytoscapeInstance.nodes().length > 0)
    if (ready) break
  }
}

const preTap = await page.evaluate(() => {
  const cy = window.cytoscapeInstance
  if (!cy) return { error: 'still no cy' }
  const n = cy.nodes().toArray().sort((a, b) => a.id().localeCompare(b.id()))[0]
  // Center node in viewport so mouse.click lands on it
  cy.center(n)
  cy.zoom({ level: 1.5, renderedPosition: { x: window.innerWidth / 2, y: window.innerHeight / 2 } })
  return {
    id: n.id(),
    rendered: n.renderedPosition(),
    bb: n.renderedBoundingBox(),
    cyCount: cy.nodes().length,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  }
})
console.log('pre-tap:', JSON.stringify(preTap, null, 2))

if (preTap.error) { console.log('consoleLines:', consoleLines.slice(-40).join('\n')); await b.close(); process.exit(1) }

await page.screenshot({ path: '/tmp/vt-debug/wave6-repro/post-fix-0-pre-tap.png', fullPage: true })

await page.mouse.click(preTap.rendered.x, preTap.rendered.y)
await page.waitForTimeout(700)

const afterTap = await page.evaluate(() => ({
  editors: Array.from(document.querySelectorAll('[id^="window-"][id$="-editor"]')).map(e => e.id),
  selected: window.cytoscapeInstance.$(':selected').map(n => n.id()),
  cyCount: window.cytoscapeInstance.nodes().length,
}))
console.log('after tap:', JSON.stringify(afterTap, null, 2))
await page.screenshot({ path: '/tmp/vt-debug/wave6-repro/post-fix-1-after-tap.png', fullPage: true })

// Programmatic direct click on Add Child button (bypasses hit-test flakiness)
const cyCountBefore = afterTap.cyCount
const directClick = await page.evaluate(() => {
  const editors = Array.from(document.querySelectorAll('[id^="window-"][id$="-editor"]'))
  for (const ed of editors) {
    const btns = Array.from(ed.querySelectorAll('button'))
    for (const btn of btns) {
      const title = btn.getAttribute('title') || ''
      const r = btn.getBoundingClientRect()
      if (/add child/i.test(title) && r.width > 0) {
        btn.click()
        return { clicked: true, editorId: ed.id, rect: { x: r.x, y: r.y, w: r.width, h: r.height } }
      }
    }
  }
  return { error: 'no add child button visible' }
})
console.log('direct click on Add Child:', JSON.stringify(directClick))

await page.waitForTimeout(2000)
const afterAdd = await page.evaluate(() => {
  const cy = window.cytoscapeInstance
  return {
    cyCount: cy.nodes().length,
    selectedIds: cy.$(':selected').map(n => n.id()),
    editors: Array.from(document.querySelectorAll('[id^="window-"][id$="-editor"]')).map(e => e.id),
    // Find any new node's rect
    newNodeIds: cy.nodes().toArray().map(n => n.id()).filter(id => !id.includes('_0.md')),
  }
})
console.log('after add:', JSON.stringify({
  cyCountBefore,
  cyCountAfter: afterAdd.cyCount,
  delta: afterAdd.cyCount - cyCountBefore,
  editors: afterAdd.editors,
  selectedIds: afterAdd.selectedIds,
}, null, 2))

await page.screenshot({ path: '/tmp/vt-debug/wave6-repro/post-fix-2-after-add.png', fullPage: true })

console.log('\n=== CONSOLE (last 40) ===')
for (const l of consoleLines.slice(-40)) console.log(l)

await b.close()
