/**
 * Browser VoiceTree — multi-project read paths (daemon round-trip).
 *
 * Exercises hostAPI.main.addReadPath / removeReadPath: the multi-project
 * mechanism where a user folds an additional folder into the live graph and its
 * nodes appear in the projection.
 *
 * ── KNOWN BUG (encoded as test.fail) ───────────────────────────────────────────
 * In browser mode these are currently BROKEN. `browserRuntime.ts` forwards them
 * as JSON-RPC method names `addReadPath` / `removeReadPath`, but VTD's graph
 * gateway registers no such method (the gateway names are all `graph.*`, and
 * cluster-1 explicitly noted "graphd exposes no read-path route via the gateway
 * client"). So the RPC rejects with `Unknown method: addReadPath` and no folder
 * is ever folded in. Properly supporting this needs a NEW VTD gateway route +
 * graphd client method (daemon work, owned by Jun) — NOT a webapp-only fix, so it
 * is left for that work rather than hacked around here.
 *
 * The test below drives the FULL desired behaviour (add a folder, assert its
 * nodes surface; remove it, assert they vanish) and is marked `test.fail()`:
 * it stays green while the bug exists and will report "expected to fail but
 * passed" the moment the daemon route lands — the signal to drop the annotation.
 * The actual rejection is captured and surfaced as a test annotation for evidence.
 */

import {test, expect} from '@playwright/test'
import {mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {
  loadDaemonConfig,
  injectConfig,
  waitForHostApiReady,
} from './vt-e2e-helpers.ts'

test.describe('Browser VoiceTree — multi-project read paths', () => {

  test('addReadPath surfaces the added folder\'s nodes; removeReadPath hides them', async ({page}, testInfo) => {
    // EXPECTED-FAIL until VTD exposes an add/remove-read-path gateway route.
    test.fail(true, 'browserRuntime forwards addReadPath/removeReadPath to a VTD method that is not registered (Unknown method)')

    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    // Real external fixture: a temp folder with one markdown node, fully cleaned up.
    const extDir = await mkdtemp(join(tmpdir(), 'vt-readpath-'))
    const marker = `VT_RP_${Date.now()}`
    const extFile = join(extDir, `${marker}.md`)
    await writeFile(extFile, `# ${marker}\nexternal read-path node\n`, 'utf8')

    try {
      const added = await page.evaluate(async ({extDir, extFile}) => {
        type Main = {
          addReadPath: (p: unknown) => Promise<unknown>
          getProjectedGraph: () => Promise<{nodes?: {id: string}[]}>
        }
        const api = (window as unknown as {hostAPI?: {main?: Main}}).hostAPI
        const main = api?.main
        if (!main) return {error: 'no hostAPI.main', appeared: false}
        let rpcError: string | null = null
        // Electron's contract is addReadPath(path: string) — a folder path.
        try {
          await main.addReadPath(extDir)
        } catch (e) {
          rpcError = e instanceof Error ? e.message : String(e)
        }
        const deadline = Date.now() + 6000
        let appeared = false
        while (Date.now() < deadline) {
          const proj = await main.getProjectedGraph()
          if ((proj.nodes ?? []).some((n) => n.id === extFile)) {appeared = true; break}
          await new Promise((r) => setTimeout(r, 150))
        }
        return {rpcError, appeared}
      }, {extDir, extFile})

      if (added.rpcError) {
        testInfo.annotations.push({type: 'observed-bug', description: `addReadPath rejected: ${added.rpcError}`})
      }
      // The desired observable: the external folder's node is now in the projection.
      expect(added.appeared, `node from added read path (${extFile}) must appear in the projected graph`).toBe(true)

      const removed = await page.evaluate(async ({extDir, extFile}) => {
        type Main = {
          removeReadPath: (p: unknown) => Promise<unknown>
          getProjectedGraph: () => Promise<{nodes?: {id: string}[]}>
        }
        const main = (window as unknown as {hostAPI?: {main?: Main}}).hostAPI?.main
        if (!main) return {gone: false}
        try { await main.removeReadPath(extDir) } catch { /* surfaced via add path already */ }
        const deadline = Date.now() + 6000
        let gone = false
        while (Date.now() < deadline) {
          const proj = await main.getProjectedGraph()
          if (!(proj.nodes ?? []).some((n) => n.id === extFile)) {gone = true; break}
          await new Promise((r) => setTimeout(r, 150))
        }
        return {gone}
      }, {extDir, extFile})
      expect(removed.gone, 'removeReadPath must drop the folder\'s nodes from the projection').toBe(true)
    } finally {
      await rm(extDir, {recursive: true, force: true})
    }
  })

})
