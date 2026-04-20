import { chromium } from 'playwright-core'
const b = await chromium.connectOverCDP('http://localhost:9234')
const page = b.contexts()[0].pages()[0]

const state = await page.evaluate(() => {
  const cy = window.cytoscapeInstance
  if (!cy) return { error: 'no cy' }
  const viewport = { w: window.innerWidth, h: window.innerHeight }
  const nodesSorted = cy.nodes().toArray().sort((a, b) => a.id().localeCompare(b.id()))
  const primary = nodesSorted[0]
  const editors = Array.from(document.querySelectorAll('[id^="window-"][id$="-editor"]'))
  const perEditor = editors.map(ed => {
    const r = ed.getBoundingClientRect()
    const addBtn = Array.from(ed.querySelectorAll('button')).find(b => (b.getAttribute('title') || '') === 'Add Child')
    const br = addBtn?.getBoundingClientRect() ?? null
    return {
      id: ed.id,
      editorRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      addBtnRect: br ? { x: br.x, y: br.y, w: br.width, h: br.height } : null,
      addBtnInViewport: br ? (br.x >= 0 && br.y >= 0 && br.x + br.width <= viewport.w && br.y + br.height <= viewport.h) : null,
    }
  })
  return {
    viewport,
    primaryId: primary.id,
    primaryRendered: primary.renderedPosition(),
    cyViewport: { zoom: cy.zoom(), pan: cy.pan() },
    editors: perEditor,
  }
})
console.log(JSON.stringify(state, null, 2))
await b.close()
