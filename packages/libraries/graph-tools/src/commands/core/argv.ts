import path from 'node:path'

export type DebugTargetArgs = {
  port?: number
  pid?: number
  project?: string
  forceNew?: boolean
}

type ConsumeResult =
  | { matched: true; nextIndex: number }
  | { matched: false; nextIndex: number }

type DebugTargetFlagOptions = {
  allowForceNew?: boolean
  resolveProject?: boolean
}

export function readFlagValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

export function parseIntegerFlag(flag: string, value: string | undefined): number {
  const parsed = Number.parseInt(readFlagValue(flag, value), 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires an integer`)
  }
  return parsed
}

export function parseBooleanFlag(flag: string, value: string | undefined): boolean {
  const raw = readFlagValue(flag, value)
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${flag} must be true or false`)
}

export function consumeDebugTargetFlag(
  argv: readonly string[],
  index: number,
  target: DebugTargetArgs,
  options: DebugTargetFlagOptions = {},
): ConsumeResult {
  const arg = argv[index]
  if (arg === '--port' || arg === '--cdpPort') {
    target.port = parseIntegerFlag('--port', argv[index + 1])
    return { matched: true, nextIndex: index + 1 }
  }
  if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
    target.port = parseIntegerFlag('--port', arg.slice(arg.indexOf('=') + 1))
    return { matched: true, nextIndex: index }
  }
  if (arg === '--pid') {
    target.pid = parseIntegerFlag('--pid', argv[index + 1])
    return { matched: true, nextIndex: index + 1 }
  }
  if (arg.startsWith('--pid=')) {
    target.pid = parseIntegerFlag('--pid', arg.slice('--pid='.length))
    return { matched: true, nextIndex: index }
  }
  if (arg === '--project') {
    const project = readFlagValue('--project', argv[index + 1])
    target.project = options.resolveProject ? path.resolve(project) : project
    return { matched: true, nextIndex: index + 1 }
  }
  if (arg.startsWith('--project=')) {
    const project = readFlagValue('--project', arg.slice('--project='.length))
    target.project = options.resolveProject ? path.resolve(project) : project
    return { matched: true, nextIndex: index }
  }
  if (options.allowForceNew && arg === '--new') {
    target.forceNew = true
    return { matched: true, nextIndex: index }
  }
  return { matched: false, nextIndex: index }
}
