import { registerCommand } from './index'
import { readInstancesDir, filterLive } from '../debug/discover'
import { ok } from '../debug/Response'
import type { Response } from '../debug/Response'

async function lsHandler(_argv: string[]): Promise<Response<unknown>> {
  const all = await readInstancesDir()
  const live = await filterLive(all)
  return ok('ls', live)
}

registerCommand('ls', lsHandler)
