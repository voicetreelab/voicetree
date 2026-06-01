import { registerCommand } from '../index'
import { filterInstancesBySelector, listLiveInstances } from '@vt/graph-tools/debug/protocol/discover'
import { ok } from '@vt/graph-tools/debug/protocol/Response'
import type { Response } from '@vt/graph-tools/debug/protocol/Response'

type LsOptions = {
  port?: number
  pid?: number
  project?: string
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
    } else if (arg === '--project') {
      options.project = argv[++i]
    } else if (arg.startsWith('--project=')) {
      options.project = arg.slice('--project='.length)
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
