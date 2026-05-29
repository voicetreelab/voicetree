import {
  liveApply,
  liveFocus,
  liveNeighbors,
  livePath,
  liveStateDump,
  liveView,
  type ViewFormat,
} from '../../../src/node'
import {fail} from '../shared'
import {isLiveCrudVerb, parseLiveCrudCommand} from './liveCrudParse'
import {
  getLiveGraphNodes,
  persistLiveCrudCommand,
  resolveCommandNodeIds,
} from './liveCrudPersistence'

interface ParsedLiveViewArgs {
  readonly format: ViewFormat
  readonly collapsedFolders: readonly string[]
  readonly selectedIds: readonly string[]
  readonly port?: number
}

export function liveUsage(): string {
  return [
    'Usage: vt-graph live <subcommand> [args]',
    '',
    'Subcommands:',
    '  view       Render the live graph.',
    '  state dump Print live SerializedState JSON.',
    '  apply      Apply raw Command JSON to the live graph.',
    '  add-node   Add a node to the live graph.',
    '  rm-node    Remove a node from the live graph.',
    '  add-edge   Add an edge to the live graph.',
    '  rm-edge    Remove an edge from the live graph.',
    '  mv-node    Move a node in the live graph.',
    '  focus      Render a focused ego graph.',
    '  neighbors  Render a node neighborhood.',
    '  path       Render a path between two nodes.',
  ].join('\n')
}

function parsePortFlagValue(value: string | undefined): number {
  if (!value || value.startsWith('--')) fail('--port requires a value')
  return parseInt(value, 10)
}

function parseLiveViewArgs(liveArgs: readonly string[]): ParsedLiveViewArgs {
  let format: ViewFormat = 'ascii'
  const collapsedFolders: string[] = []
  const selectedIds: string[] = []
  let port: number | undefined

  for (let i = 0; i < liveArgs.length; i++) {
    const arg = liveArgs[i]
    if (arg === '--mermaid') { format = 'mermaid'; continue }
    if (arg === '--ascii') { format = 'ascii'; continue }
    if (arg === '--collapse') {
      const next = liveArgs[++i]
      if (!next || next.startsWith('--')) fail('--collapse requires a value')
      collapsedFolders.push(next)
      continue
    }
    if (arg.startsWith('--collapse=')) {
      collapsedFolders.push(arg.slice('--collapse='.length))
      continue
    }
    if (arg === '--select') {
      const next = liveArgs[++i]
      if (!next || next.startsWith('--')) fail('--select requires a value')
      selectedIds.push(next)
      continue
    }
    if (arg.startsWith('--select=')) {
      selectedIds.push(arg.slice('--select='.length))
      continue
    }
    if (arg === '--port') {
      port = parsePortFlagValue(liveArgs[++i])
      continue
    }
    if (arg.startsWith('--port=')) {
      port = parseInt(arg.slice('--port='.length), 10)
      continue
    }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }

  return {format, collapsedFolders, selectedIds, port}
}

function parseLiveStateDumpArgs(stateArgs: readonly string[]): {readonly pretty: boolean; readonly port?: number} {
  let pretty = true
  let port: number | undefined
  for (let i = 0; i < stateArgs.length; i++) {
    const arg = stateArgs[i]
    if (arg === '--pretty') { pretty = true; continue }
    if (arg === '--no-pretty') { pretty = false; continue }
    if (arg === '--port') {
      port = parsePortFlagValue(stateArgs[++i])
      continue
    }
    if (arg.startsWith('--port=')) {
      port = parseInt(arg.slice('--port='.length), 10)
      continue
    }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }
  return {pretty, port}
}

function parseLiveApplyArgs(liveArgs: readonly string[]): {readonly cmdJson: string; readonly port?: number} {
  let cmdJson: string | undefined
  let port: number | undefined
  for (let i = 0; i < liveArgs.length; i++) {
    const arg = liveArgs[i]
    if (arg === '--port') {
      port = parsePortFlagValue(liveArgs[++i])
      continue
    }
    if (arg.startsWith('--port=')) {
      port = parseInt(arg.slice('--port='.length), 10)
      continue
    }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
    if (cmdJson !== undefined) fail(`Unexpected argument: ${arg}`)
    cmdJson = arg
  }
  if (!cmdJson) fail("Usage: vt-graph live apply '<json-cmd>' [--port N]")
  return {cmdJson, port}
}

function parseLiveNeighborhoodArgs(
  liveArgs: readonly string[],
  usageLine: string,
): {readonly nodeId: string; readonly hops: number; readonly port?: number} {
  const nodeId = liveArgs[0]
  if (!nodeId || nodeId.startsWith('--')) fail(usageLine)

  let hops = 1
  let port: number | undefined
  for (let i = 1; i < liveArgs.length; i++) {
    const arg = liveArgs[i]
    if (arg === '--hops') {
      const next = liveArgs[++i]
      if (!next || next.startsWith('--')) fail('--hops requires a value')
      hops = parseInt(next, 10)
      continue
    }
    if (arg.startsWith('--hops=')) { hops = parseInt(arg.slice('--hops='.length), 10); continue }
    if (arg === '--port') {
      port = parsePortFlagValue(liveArgs[++i])
      continue
    }
    if (arg.startsWith('--port=')) { port = parseInt(arg.slice('--port='.length), 10); continue }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }

  return {nodeId, hops, port}
}

function parseLivePathArgs(liveArgs: readonly string[]): {readonly nodeA: string; readonly nodeB: string; readonly port?: number} {
  const nodeA = liveArgs[0]
  const nodeB = liveArgs[1]
  if (!nodeA || nodeA.startsWith('--') || !nodeB || nodeB.startsWith('--')) {
    fail('Usage: vt-graph live path <a> <b> [--port N]')
  }

  let port: number | undefined
  for (let i = 2; i < liveArgs.length; i++) {
    const arg = liveArgs[i]
    if (arg === '--port') {
      port = parsePortFlagValue(liveArgs[++i])
      continue
    }
    if (arg.startsWith('--port=')) { port = parseInt(arg.slice('--port='.length), 10); continue }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }

  return {nodeA, nodeB, port}
}

export async function runLiveCommand(args: readonly string[]): Promise<void> {
  const [liveSubcommand, ...liveArgs] = args

  if (!liveSubcommand || liveSubcommand === '--help') {
    console.log(liveUsage())
    return
  }

  if (liveSubcommand === 'view') {
    const {format, collapsedFolders, selectedIds, port} = parseLiveViewArgs(liveArgs)
    const result = await liveView({format, collapsedFolders, selectedIds, port})
    console.log(result.output)
    if (format === 'ascii') {
      console.log(`\n${result.nodeCount} nodes — ${result.folderNodeCount} folder nodes, ${result.virtualFolderCount} virtual folders, ${result.fileNodeCount} files`)
    }
    return
  }

  if (liveSubcommand === 'state') {
    const [stateSubcmd, ...stateArgs] = liveArgs
    if (stateSubcmd !== 'dump') {
      fail('Usage: vt-graph live state dump [--no-pretty] [--port N]')
    }
    const {pretty, port} = parseLiveStateDumpArgs(stateArgs)
    const result = await liveStateDump({pretty, port})
    process.stdout.write(result.json)
    return
  }

  if (liveSubcommand === 'apply') {
    const {cmdJson, port} = parseLiveApplyArgs(liveArgs)
    const result = await liveApply(cmdJson, {port})
    process.stdout.write(result.output)
    return
  }

  if (isLiveCrudVerb(liveSubcommand)) {
    const parsed = parseLiveCrudCommand(liveSubcommand, liveArgs)
    if (parsed.type === 'help') {
      console.log(parsed.text)
      return
    }
    const beforeNodes = await getLiveGraphNodes(parsed.projectPath)
    const resolvedParsed = resolveCommandNodeIds(parsed, beforeNodes)
    const result = await liveApply(JSON.stringify(resolvedParsed.command), {projectPath: resolvedParsed.projectPath})
    const afterNodes = await getLiveGraphNodes(resolvedParsed.projectPath)
    await persistLiveCrudCommand(resolvedParsed, result.delta, beforeNodes, afterNodes)
    process.stdout.write(result.output)
    return
  }

  if (liveSubcommand === 'focus') {
    const {nodeId, hops, port} = parseLiveNeighborhoodArgs(
      liveArgs,
      'Usage: vt-graph live focus <node> [--hops N] [--port N]',
    )
    console.log(await liveFocus(nodeId, {hops, port}))
    return
  }

  if (liveSubcommand === 'neighbors') {
    const {nodeId, hops, port} = parseLiveNeighborhoodArgs(
      liveArgs,
      'Usage: vt-graph live neighbors <node> [--hops N] [--port N]',
    )
    console.log(await liveNeighbors(nodeId, {hops, port}))
    return
  }

  if (liveSubcommand === 'path') {
    const {nodeA, nodeB, port} = parseLivePathArgs(liveArgs)
    console.log(await livePath(nodeA, nodeB, {port}))
    return
  }

  fail(`error: unknown live subcommand "${liveSubcommand}"\n${liveUsage()}`)
}
