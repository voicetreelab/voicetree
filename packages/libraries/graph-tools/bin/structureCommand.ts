import * as path from 'node:path'
import {
  renderGraphView,
  createLiveTransport,
  type ViewFormat,
} from '../src/node'
import {buildAutoViewGraph, renderTreeCover} from '../src/view/autoView'

function fail(message: string): never {
  throw new Error(message)
}

function getRequiredValue(parsedArgs: string[], index: number, flag: string): string {
  const value: string | undefined = parsedArgs[index]
  if (!value || value.startsWith('--')) {
    fail(`${flag} requires a value`)
  }
  return value
}

interface DaemonOverlay {
  readonly collapsed: ReadonlySet<string>
  readonly selected: ReadonlySet<string>
  readonly defaultRoot: string | undefined
}

async function tryGetDaemonOverlay(projectPath?: string): Promise<DaemonOverlay | undefined> {
  try {
    const transport = createLiveTransport(projectPath)
    const state = await transport.getLiveState()
    const defaultRoot = state.roots.loaded.size > 0
      ? [...state.roots.loaded][0]
      : undefined
    return {
      collapsed: state.collapseSet,
      selected: state.selection,
      defaultRoot,
    }
  } catch {
    return undefined
  }
}

export async function runStructureCommand(args: string[]): Promise<void> {
  let folderPath: string | undefined
  let format: ViewFormat = 'ascii'
  let showCrossEdges: boolean = true
  const collapsedFolders: string[] = []
  const selectedIds: string[] = []
  let autoExplicit: boolean | undefined
  let explicitRender = false
  let budget = 30
  let budgetExplicit = false
  let projectPath: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--auto') { autoExplicit = true; continue }
    if (arg === '--no-auto') { autoExplicit = false; continue }
    if (arg === '--budget') {
      const next = getRequiredValue(args, i + 1, '--budget')
      const parsed = Number.parseInt(next, 10)
      if (!Number.isInteger(parsed) || parsed < 1) {
        fail('--budget requires a positive integer')
      }
      budget = parsed
      budgetExplicit = true
      i += 1
      continue
    }
    if (arg.startsWith('--budget=')) {
      const parsed = Number.parseInt(arg.slice('--budget='.length), 10)
      if (!Number.isInteger(parsed) || parsed < 1) {
        fail('--budget requires a positive integer')
      }
      budget = parsed
      budgetExplicit = true
      continue
    }
    if (arg === '--mermaid') { format = 'mermaid'; explicitRender = true; continue }
    if (arg === '--ascii') { format = 'ascii'; explicitRender = true; continue }
    if (arg.startsWith('--format=')) {
      const value: string = arg.slice('--format='.length)
      if (value !== 'ascii' && value !== 'mermaid') {
        fail(`Unknown format: ${value}`)
      }
      format = value
      explicitRender = true
      continue
    }
    if (arg === '--no-cross-edges') { showCrossEdges = false; explicitRender = true; continue }
    if (arg === '--collapse') {
      const next: string | undefined = args[++i]
      if (!next || next.startsWith('--')) {
        fail('--collapse requires a folder argument')
      }
      collapsedFolders.push(next)
      explicitRender = true
      continue
    }
    if (arg.startsWith('--collapse=')) {
      collapsedFolders.push(arg.slice('--collapse='.length))
      explicitRender = true
      continue
    }
    if (arg === '--select') {
      const next: string | undefined = args[++i]
      if (!next || next.startsWith('--')) {
        fail('--select requires a node id argument')
      }
      selectedIds.push(next)
      explicitRender = true
      continue
    }
    if (arg.startsWith('--select=')) {
      selectedIds.push(arg.slice('--select='.length))
      explicitRender = true
      continue
    }
    if (arg === '--project') {
      const next: string | undefined = args[++i]
      if (!next || next.startsWith('--')) {
        fail('--project requires a value')
      }
      projectPath = next
      continue
    }
    if (arg.startsWith('--project=')) {
      projectPath = arg.slice('--project='.length)
      continue
    }
    if (arg.startsWith('--')) {
      fail(`Unknown argument: ${arg}`)
    }
    if (folderPath !== undefined) {
      fail(`Unexpected argument: ${arg}`)
    }
    folderPath = arg
  }

  const autoMode = autoExplicit ?? !explicitRender

  if (autoMode) {
    if (explicitRender) {
      fail('--auto cannot be combined with --ascii/--mermaid/--format/--collapse/--select/--no-cross-edges')
    }
    const overlay = await tryGetDaemonOverlay(projectPath)
    const resolvedFolder = folderPath
      ? path.resolve(folderPath)
      : (overlay?.defaultRoot ?? process.cwd())

    const graph = buildAutoViewGraph(resolvedFolder)
    const output = renderTreeCover(graph, {
      budget,
      collapsed: overlay?.collapsed,
      selected: overlay?.selected,
    })
    console.log(output)
    return
  }

  if (budgetExplicit) {
    fail('--budget can only be used with the default auto view or --auto')
  }

  const resolvedFolder = folderPath || process.cwd()
  const result = renderGraphView(resolvedFolder, {format, showCrossEdges, collapsedFolders, selectedIds})
  console.log(result.output)
  if (format === 'ascii') {
    console.log(`\n${result.nodeCount} nodes — ${result.folderNodeCount} folder nodes, ${result.virtualFolderCount} virtual folders, ${result.fileNodeCount} files`)
  }
}
