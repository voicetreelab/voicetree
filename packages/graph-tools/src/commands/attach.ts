import { registerCommand } from './index'
import { readInstancesDir, filterLive, pickInstance, type DebugInstance } from '../debug/discover'
import { openDebugSession } from '../debug/playwrightSession'
import { ok, err } from '../debug/Response'
import type { Response } from '../debug/Response'

export type AttachResult = {
  pageTitle: string
  url: string
  tabs: number
  pid: number
  cdpPort: number
}

async function attachToInstance(instance: DebugInstance): Promise<Response<AttachResult>> {
  let session: Awaited<ReturnType<typeof openDebugSession>> | null = null
  try {
    session = await openDebugSession(instance)
    const pages = session.pages
    if (pages.length === 0) {
      return err('attach', 'CDP connected but no pages found', 'verify app is fully started')
    }
    const page = pages[0]
    const pageTitle = await page.title()
    const url = page.url()
    return ok('attach', { pageTitle, url, tabs: pages.length, pid: instance.pid, cdpPort: instance.cdpPort })
  } catch (e) {
    return err(
      'attach',
      `CDP connect failed: ${String(e)}`,
      'Is ENABLE_PLAYWRIGHT_DEBUG=1 set and Voicetree running in dev mode?',
      3,
    )
  } finally {
    if (session) {
      await session.close()
    }
  }
}

async function attachHandler(argv: string[]): Promise<Response<unknown>> {
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port') {
      port = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--port=')) {
      port = parseInt(arg.slice('--port='.length), 10)
    } else if (arg === '--pid') {
      pid = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--pid=')) {
      pid = parseInt(arg.slice('--pid='.length), 10)
    } else if (arg === '--vault') {
      vault = argv[++i]
    } else if (arg.startsWith('--vault=')) {
      vault = arg.slice('--vault='.length)
    }
  }

  const all = await readInstancesDir()
  const live = await filterLive(all)
  const pick = pickInstance(live, { port, pid, vault })

  if (!pick.ok) {
    return err('attach', pick.message, pick.hint, 2)
  }

  return attachToInstance(pick.instance)
}

registerCommand('attach', attachHandler)
