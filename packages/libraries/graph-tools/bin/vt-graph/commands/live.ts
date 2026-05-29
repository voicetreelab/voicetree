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

// Exit code emitted by `live focus|neighbors|path` when a queried node id is
// unknown (a typo). It is distinct from both success (0) and a genuine
// disconnected-pair "no path" result (also 0), so callers and agents can tell a
// typo apart from a real no-path. See REC 5.
export const EGO_NOT_FOUND_EXIT_CODE = 3

/**
 * Emit an EgoRender from `live focus|neighbors|path`, choosing the exit code:
 *   - 'not-found' (unknown / typo'd node id) → stderr + non-zero exit code
 *   - 'ok' / 'no-path' (valid query results) → stdout + exit 0
 *
 * Uses `process.exitCode` (not `process.exit`) so the process drains naturally
 * and the behavior is unit-testable by inspecting `process.exitCode`.
 */
export function emitEgoRender(render: {readonly kind: 'ok' | 'not-found' | 'no-path'; readonly text: string}): void {
  if (render.kind === 'not-found') {
    process.stderr.write(`${render.text}\n`)
    process.exitCode = EGO_NOT_FOUND_EXIT_CODE
    return
  }
  console.log(render.text)
}

function parseLiveViewArgs(liveArgs: readonly string[]): ParsedLiveViewArgs {
  let format: ViewFormat = 'ascii'
  const collapsedFolders: string[] = []
  const selectedIds: string[] = []

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
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }

  return {format, collapsedFolders, selectedIds}
}

function parseLiveStateDumpArgs(stateArgs: readonly string[]): {readonly pretty: boolean} {
  let pretty = true
  for (let i = 0; i < stateArgs.length; i++) {
    const arg = stateArgs[i]
    if (arg === '--pretty') { pretty = true; continue }
    if (arg === '--no-pretty') { pretty = false; continue }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }
  return {pretty}
}

function parseLiveApplyArgs(liveArgs: readonly string[]): {readonly cmdJson: string} {
  let cmdJson: string | undefined
  for (let i = 0; i < liveArgs.length; i++) {
    const arg = liveArgs[i]
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
    if (cmdJson !== undefined) fail(`Unexpected argument: ${arg}`)
    cmdJson = arg
  }
  if (!cmdJson) fail("Usage: vt-graph live apply '<json-cmd>'")
  return {cmdJson}
}

function parseLiveNeighborhoodArgs(
  liveArgs: readonly string[],
  usageLine: string,
): {readonly nodeId: string; readonly hops: number} {
  const nodeId = liveArgs[0]
  if (!nodeId || nodeId.startsWith('--')) fail(usageLine)

  let hops = 1
  for (let i = 1; i < liveArgs.length; i++) {
    const arg = liveArgs[i]
    if (arg === '--hops') {
      const next = liveArgs[++i]
      if (!next || next.startsWith('--')) fail('--hops requires a value')
      hops = parseInt(next, 10)
      continue
    }
    if (arg.startsWith('--hops=')) { hops = parseInt(arg.slice('--hops='.length), 10); continue }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }

  return {nodeId, hops}
}

function parseLivePathArgs(liveArgs: readonly string[]): {readonly nodeA: string; readonly nodeB: string} {
  const nodeA = liveArgs[0]
  const nodeB = liveArgs[1]
  if (!nodeA || nodeA.startsWith('--') || !nodeB || nodeB.startsWith('--')) {
    fail('Usage: vt-graph live path <a> <b>')
  }

  for (let i = 2; i < liveArgs.length; i++) {
    const arg = liveArgs[i]
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }

  return {nodeA, nodeB}
}

export async function runLiveCommand(args: readonly string[]): Promise<void> {
  const [liveSubcommand, ...liveArgs] = args

  if (!liveSubcommand || liveSubcommand === '--help') {
    console.log(liveUsage())
    return
  }

  if (liveSubcommand === 'view') {
    const {format, collapsedFolders, selectedIds} = parseLiveViewArgs(liveArgs)
    const result = await liveView({format, collapsedFolders, selectedIds})
    console.log(result.output)
    if (format === 'ascii') {
      console.log(`\n${result.nodeCount} nodes — ${result.folderNodeCount} folder nodes, ${result.virtualFolderCount} virtual folders, ${result.fileNodeCount} files`)
    }
    return
  }

  if (liveSubcommand === 'state') {
    const [stateSubcmd, ...stateArgs] = liveArgs
    if (stateSubcmd !== 'dump') {
      fail('Usage: vt-graph live state dump [--no-pretty]')
    }
    const {pretty} = parseLiveStateDumpArgs(stateArgs)
    const result = await liveStateDump({pretty})
    process.stdout.write(result.json)
    return
  }

  if (liveSubcommand === 'apply') {
    const {cmdJson} = parseLiveApplyArgs(liveArgs)
    const result = await liveApply(cmdJson)
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
    const {nodeId, hops} = parseLiveNeighborhoodArgs(
      liveArgs,
      'Usage: vt-graph live focus <node> [--hops N]',
    )
    emitEgoRender(await liveFocus(nodeId, {hops}))
    return
  }

  if (liveSubcommand === 'neighbors') {
    const {nodeId, hops} = parseLiveNeighborhoodArgs(
      liveArgs,
      'Usage: vt-graph live neighbors <node> [--hops N]',
    )
    emitEgoRender(await liveNeighbors(nodeId, {hops}))
    return
  }

  if (liveSubcommand === 'path') {
    const {nodeA, nodeB} = parseLivePathArgs(liveArgs)
    emitEgoRender(await livePath(nodeA, nodeB))
    return
  }

  fail(`error: unknown live subcommand "${liveSubcommand}"\n${liveUsage()}`)
}
