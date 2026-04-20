import { chromium } from 'playwright-core'
const b = await chromium.connectOverCDP('http://localhost:9234')
const ctxs = b.contexts()
console.log('contexts:', ctxs.length)
for (const ctx of ctxs) {
  const pages = ctx.pages()
  console.log('  pages:', pages.length)
  for (const p of pages) {
    const info = await p.evaluate(() => ({
      hasCy: !!window.cytoscapeInstance,
      cyNodeCount: window.cytoscapeInstance?.nodes?.().length ?? null,
      buttons: Array.from(document.querySelectorAll('button')).slice(0, 6).map(b => (b.textContent || '').slice(0, 60)),
      bodyHead: (document.body?.textContent || '').slice(0, 200),
    })).catch((e) => ({ error: e.message }))
    console.log('  url:', p.url(), JSON.stringify(info))
  }
}
await b.close()
