// Shell command: `vt-debug cy dump [--source data|projected|rendered|all]`
// Runs inside CLI (Node.js). Calls renderer via CDP page.evaluate().
// project() runs here (Node.js), never in the renderer bundle.

import { parseCyDump, type CyDump, type CySource } from '../debug/cyStateShape'
import type { State } from '@vt/graph-state'
import { projectStateToCyDump } from '../debug/projectedCyDump'

type Response<T> =
  | { ok: true; command: string; result: T }
  | { ok: false; command: string; error: string; hint?: string }

// Duck type for Playwright Page — avoids adding playwright as a hard dependency.
interface PageLike {
  evaluate<T>(fn: () => T): Promise<T>
}

// State fetcher: injected so callers can wire MCP transport (getLiveStateOverMcp) or fixtures.
type StateFetcher = () => Promise<State>

function ok<T>(result: T): Response<T> {
  return { ok: true, command: 'cy dump', result }
}

function err(msg: string, hint?: string): Response<never> {
  return { ok: false, command: 'cy dump', error: msg, ...(hint ? { hint } : {}) }
}

async function fetchRendered(page: PageLike): Promise<CyDump> {
  const raw = await page.evaluate(() => (window as unknown as Record<string, unknown>)['__vtDebug__'] &&
    ((window as unknown as Record<string, unknown>)['__vtDebug__'] as Record<string, () => unknown>)['cy']())
  return parseCyDump(raw)
}

async function fetchProjected(getState: StateFetcher): Promise<CyDump> {
  const state = await getState()
  return projectStateToCyDump(state)
}

export async function cyDump(
  page: PageLike,
  opts: { source: CySource; getState?: StateFetcher },
): Promise<Response<CyDump | Record<string, CyDump>>> {
  try {
    switch (opts.source) {
      case 'rendered':
        return ok(await fetchRendered(page))

      case 'projected': {
        if (!opts.getState) return err('--source projected requires a state fetcher', 'pass getState option')
        return ok(await fetchProjected(opts.getState))
      }

      case 'data':
        // Gap B: data layer — same as projected for now (content from state, not fs rescan).
        if (!opts.getState) return err('--source data requires a state fetcher', 'pass getState option')
        return ok(await fetchProjected(opts.getState))

      case 'all': {
        const rendered = await fetchRendered(page)
        const projected = opts.getState ? await fetchProjected(opts.getState) : null
        const result: Record<string, CyDump> = { rendered }
        if (projected) { result.projected = projected; result.data = projected }
        return ok(result as unknown as CyDump)
      }
    }
  } catch (e) {
    return err(String(e))
  }
}
