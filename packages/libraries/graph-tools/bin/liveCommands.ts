// Top-level dispatcher for `vt-graph live <subcommand>`. Owns the
// non-CRUD subcommand argument parsing (view, state dump, apply, focus,
// neighbors, path). CRUD verbs delegate to liveCrudOps.
import {
  liveStateDump,
  liveApply,
  liveView,
  liveFocus,
  liveNeighbors,
  livePath,
  type ViewFormat,
} from '../src/node'
import {
  isLiveCrudVerb,
  liveUsage,
  type LiveCrudVerb,
} from './liveCommandsTypes'
import {
  getLiveGraphNodes,
  parseLiveCrudCommand,
  persistLiveCrudCommand,
  resolveCommandNodeIds,
} from './liveCrudOps'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

interface ParsedLiveViewArgs {
  readonly format: ViewFormat
  readonly collapsedFolders: readonly string[]
  readonly selectedIds: readonly string[]
  readonly vaultPath?: string
}

function parseLiveViewArgs(liveArgs: readonly string[]): ParsedLiveViewArgs {
  let format: ViewFormat = 'ascii'
  const collapsedFolders: string[] = []
  const selectedIds: string[] = []
  let vaultPath: string | undefined

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
    if (arg === '--vault') {
      const next = liveArgs[++i]
      if (!next || next.startsWith('--')) fail('--vault requires a value')
      vaultPath = next
      continue
    }
    if (arg.startsWith('--vault=')) {
      vaultPath = arg.slice('--vault='.length)
      continue
    }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }

  return {format, collapsedFolders, selectedIds, ...(vaultPath !== undefined ? {vaultPath} : {})}
}

function parseLiveStateDumpArgs(stateArgs: readonly string[]): {readonly pretty: boolean; readonly vaultPath?: string} {
  let pretty = true
  let vaultPath: string | undefined
  for (let i = 0; i < stateArgs.length; i++) {
    const arg = stateArgs[i]
    if (arg === '--pretty') { pretty = true; continue }
    if (arg === '--no-pretty') { pretty = false; continue }
    if (arg === '--vault') {
      const next = stateArgs[++i]
      if (!next || next.startsWith('--')) fail('--vault requires a value')
      vaultPath = next
      continue
    }
    if (arg.startsWith('--vault=')) {
      vaultPath = arg.slice('--vault='.length)
      continue
    }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }
  return {pretty, ...(vaultPath !== undefined ? {vaultPath} : {})}
}

function parseLiveApplyArgs(liveArgs: readonly string[]): {readonly cmdJson: string; readonly vaultPath?: string} {
  let cmdJson: string | undefined
  let vaultPath: string | undefined
  for (let i = 0; i < liveArgs.length; i++) {
    const arg = liveArgs[i]
    if (arg === '--vault') {
      const next = liveArgs[++i]
      if (!next || next.startsWith('--')) fail('--vault requires a value')
      vaultPath = next
      continue
    }
    if (arg.startsWith('--vault=')) {
      vaultPath = arg.slice('--vault='.length)
      continue
    }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
    if (cmdJson !== undefined) fail(`Unexpected argument: ${arg}`)
    cmdJson = arg
  }
  if (!cmdJson) fail("Usage: vt-graph live apply '<json-cmd>' [--vault <path>]")
  return {cmdJson, ...(vaultPath !== undefined ? {vaultPath} : {})}
}

function parseLiveNeighborhoodArgs(
  liveArgs: readonly string[],
  usageLine: string,
): {readonly nodeId: string; readonly hops: number; readonly vaultPath?: string} {
  const nodeId = liveArgs[0]
  if (!nodeId || nodeId.startsWith('--')) fail(usageLine)

  let hops = 1
  let vaultPath: string | undefined
  for (let i = 1; i < liveArgs.length; i++) {
    const arg = liveArgs[i]
    if (arg === '--hops') {
      const next = liveArgs[++i]
      if (!next || next.startsWith('--')) fail('--hops requires a value')
      hops = parseInt(next, 10)
      continue
    }
    if (arg.startsWith('--hops=')) { hops = parseInt(arg.slice('--hops='.length), 10); continue }
    if (arg === '--vault') {
      const next = liveArgs[++i]
      if (!next || next.startsWith('--')) fail('--vault requires a value')
      vaultPath = next
      continue
    }
    if (arg.startsWith('--vault=')) { vaultPath = arg.slice('--vault='.length); continue }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }

  return {nodeId, hops, ...(vaultPath !== undefined ? {vaultPath} : {})}
}

function parseLivePathArgs(liveArgs: readonly string[]): {readonly nodeA: string; readonly nodeB: string; readonly vaultPath?: string} {
  const nodeA = liveArgs[0]
  const nodeB = liveArgs[1]
  if (!nodeA || nodeA.startsWith('--') || !nodeB || nodeB.startsWith('--')) {
    fail('Usage: vt-graph live path <a> <b> [--vault <path>]')
  }

  let vaultPath: string | undefined
  for (let i = 2; i < liveArgs.length; i++) {
    const arg = liveArgs[i]
    if (arg === '--vault') {
      const next = liveArgs[++i]
      if (!next || next.startsWith('--')) fail('--vault requires a value')
      vaultPath = next
      continue
    }
    if (arg.startsWith('--vault=')) { vaultPath = arg.slice('--vault='.length); continue }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
  }

  return {nodeA, nodeB, ...(vaultPath !== undefined ? {vaultPath} : {})}
}

async function runLiveCrudCommand(verb: LiveCrudVerb, liveArgs: readonly string[]): Promise<void> {
  const parsed = parseLiveCrudCommand(verb, liveArgs)
  const beforeNodes = await getLiveGraphNodes(parsed.vaultPath)
  const resolvedParsed = resolveCommandNodeIds(parsed, beforeNodes)
  const result = await liveApply(JSON.stringify(resolvedParsed.command), {
    ...(resolvedParsed.vaultPath !== undefined ? {vaultPath: resolvedParsed.vaultPath} : {}),
  })
  const afterNodes = await getLiveGraphNodes(resolvedParsed.vaultPath)
  await persistLiveCrudCommand(resolvedParsed, result.delta, beforeNodes, afterNodes)
  process.stdout.write(result.output)
}

export async function runLiveCommand(args: readonly string[]): Promise<void> {
  const [liveSubcommand, ...liveArgs] = args

  if (!liveSubcommand || liveSubcommand === '--help') {
    console.log(liveUsage())
    return
  }

  if (liveSubcommand === 'view') {
    const parsed = parseLiveViewArgs(liveArgs)
    const result = await liveView({
      format: parsed.format,
      collapsedFolders: parsed.collapsedFolders,
      selectedIds: parsed.selectedIds,
      ...(parsed.vaultPath !== undefined ? {vaultPath: parsed.vaultPath} : {}),
    })
    console.log(result.output)
    if (parsed.format === 'ascii') {
      console.log(`\n${result.nodeCount} nodes — ${result.folderNodeCount} folder nodes, ${result.virtualFolderCount} virtual folders, ${result.fileNodeCount} files`)
    }
    return
  }

  if (liveSubcommand === 'state') {
    const [stateSubcmd, ...stateArgs] = liveArgs
    if (stateSubcmd !== 'dump') {
      fail('Usage: vt-graph live state dump [--no-pretty] [--vault <path>]')
    }
    const parsed = parseLiveStateDumpArgs(stateArgs)
    const result = await liveStateDump({
      pretty: parsed.pretty,
      ...(parsed.vaultPath !== undefined ? {vaultPath: parsed.vaultPath} : {}),
    })
    process.stdout.write(result.json)
    return
  }

  if (liveSubcommand === 'apply') {
    const parsed = parseLiveApplyArgs(liveArgs)
    const result = await liveApply(parsed.cmdJson, {
      ...(parsed.vaultPath !== undefined ? {vaultPath: parsed.vaultPath} : {}),
    })
    process.stdout.write(result.output)
    return
  }

  if (isLiveCrudVerb(liveSubcommand)) {
    await runLiveCrudCommand(liveSubcommand, liveArgs)
    return
  }

  if (liveSubcommand === 'focus') {
    const {nodeId, hops, vaultPath} = parseLiveNeighborhoodArgs(
      liveArgs,
      'Usage: vt-graph live focus <node> [--hops N] [--vault <path>]',
    )
    console.log(await liveFocus(nodeId, {hops, ...(vaultPath !== undefined ? {vaultPath} : {})}))
    return
  }

  if (liveSubcommand === 'neighbors') {
    const {nodeId, hops, vaultPath} = parseLiveNeighborhoodArgs(
      liveArgs,
      'Usage: vt-graph live neighbors <node> [--hops N] [--vault <path>]',
    )
    console.log(await liveNeighbors(nodeId, {hops, ...(vaultPath !== undefined ? {vaultPath} : {})}))
    return
  }

  if (liveSubcommand === 'path') {
    const {nodeA, nodeB, vaultPath} = parseLivePathArgs(liveArgs)
    console.log(await livePath(nodeA, nodeB, vaultPath !== undefined ? {vaultPath} : {}))
    return
  }

  fail(`error: unknown live subcommand "${liveSubcommand}"\n${liveUsage()}`)
}
