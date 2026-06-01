import type { PickOpts } from '../debug/protocol/discover'
import type { Response } from '../debug/protocol/Response'

export type Handler = (argv: string[]) => Promise<Response<unknown>>

export const commandRegistry: Map<string, Handler> = new Map()

export function registerCommand(name: string, handler: Handler): void {
  commandRegistry.set(name, handler)
}

export type SelectorExtraction = { opts: PickOpts; rest: string[] }

export function extractSelectorFlags(argv: string[]): SelectorExtraction {
  const opts: PickOpts = {}
  const rest: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' || arg === '--cdpPort') {
      const val = argv[++i]
      if (val !== undefined) opts.port = Number(val)
    } else if (arg?.startsWith('--port=') || arg?.startsWith('--cdpPort=')) {
      opts.port = Number(arg.slice(arg.indexOf('=') + 1))
    } else if (arg === '--pid') {
      const val = argv[++i]
      if (val !== undefined) opts.pid = Number(val)
    } else if (arg?.startsWith('--pid=')) {
      opts.pid = Number(arg.slice('--pid='.length))
    } else if (arg === '--project') {
      const val = argv[++i]
      if (val !== undefined) opts.project = val
    } else if (arg?.startsWith('--project=')) {
      opts.project = arg.slice('--project='.length)
    } else if (arg === '--new') {
      opts.forceNew = true
    } else {
      rest.push(arg!)
    }
  }

  return { opts, rest }
}
