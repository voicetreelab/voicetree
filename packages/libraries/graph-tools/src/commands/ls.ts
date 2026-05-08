import { registerCommand } from './index'
import { filterInstancesBySelector, listLiveInstances } from '../debug/discover'
import { ok } from '../debug/Response'
import type { Response } from '../debug/Response'

type LsOptions = {
  port?: number
  pid?: number
  vault?: string
}

function parseArgs(argv: string[]): LsOptions {
  const options: LsOptions = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' || arg === '--cdpPort') {
      options.port = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
      options.port = parseInt(arg.slice(arg.indexOf('=') + 1), 10)
    } else if (arg === '--pid') {
      options.pid = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--pid=')) {
      options.pid = parseInt(arg.slice('--pid='.length), 10)
    } else if (arg === '--vault') {
      options.vault = argv[++i]
    } else if (arg.startsWith('--vault=')) {
      options.vault = arg.slice('--vault='.length)
    }
  }

  return options
}

async function lsHandler(argv: string[]): Promise<Response<unknown>> {
  const options = parseArgs(argv)
  const live = await listLiveInstances()
  return ok('ls', filterInstancesBySelector(live, options))
}

registerCommand('ls', lsHandler)
