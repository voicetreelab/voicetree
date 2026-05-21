// Live-CRUD operations: arg → command parsing, daemon-state I/O, and the
// command-side filesystem persistence step. Wikilink / path-identity helpers
// live in liveEdgePersist.ts. Extracted from vt-graph.ts (Step 7c).
import fs from 'node:fs'
import path from 'node:path'

import {hydrateState, type Delta, type SerializedCommand, type SerializedState} from '@vt/graph-state'
import {liveStateDump} from '../src/node'

import {
  LIVE_CRUD_FLAGS,
  type FlagSpec,
  type LiveCrudVerb,
  type LiveGraphNodeSnapshot,
  type LiveGraphNodesSnapshot,
  type ParsedLiveCrudCommand,
  liveCrudUsage,
} from './liveCommandsTypes'
import {
  appendLineIfMissing,
  edgeLine,
  findLoadedRootForFile,
  pathIdentitiesOverlap,
  removeEdgeLine,
  withTrailingNewline,
} from './liveEdgePersist'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

// ── Flag-value parsing ─────────────────────────────────────────────────────

function validFlagsMessage(verb: LiveCrudVerb): string {
  return `Valid flags: ${LIVE_CRUD_FLAGS[verb].map((spec) => spec.name).join(', ')}`
}

function splitFlagArg(arg: string): {readonly flag: string; readonly value?: string} {
  const equalsIndex = arg.indexOf('=')
  if (equalsIndex === -1) return {flag: arg}
  return {flag: arg.slice(0, equalsIndex), value: arg.slice(equalsIndex + 1)}
}

function parseNumberValue(flag: string, value: string): number {
  if (value === '') fail(`error: ${flag} requires a numeric value`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) fail(`error: ${flag} expected a number, got '${value}'`)
  return parsed
}

function parseLiveCrudFlagValues(
  verb: LiveCrudVerb,
  argsForVerb: readonly string[],
): Record<string, string | number | undefined> {
  const specs = LIVE_CRUD_FLAGS[verb]
  const specByName = new Map<string, FlagSpec>(specs.map((spec) => [spec.name, spec]))
  const values: Record<string, string | number | undefined> = {}

  for (let i = 0; i < argsForVerb.length; i++) {
    const arg = argsForVerb[i]
    if (!arg.startsWith('--')) {
      fail(`error: unexpected argument '${arg}' for '${verb}'. ${validFlagsMessage(verb)}`)
    }

    const {flag, value: inlineValue} = splitFlagArg(arg)
    const spec = specByName.get(flag)
    if (!spec) {
      fail(`error: unknown flag ${flag} for '${verb}'. ${validFlagsMessage(verb)}`)
    }

    const rawValue = inlineValue ?? argsForVerb[++i]
    if (rawValue === undefined || rawValue.startsWith('--')) {
      const valueKind = spec.kind === 'number' ? 'numeric' : 'string'
      fail(`error: ${flag} requires a ${valueKind} value`)
    }

    values[flag] = spec.kind === 'number' ? parseNumberValue(flag, rawValue) : rawValue
  }

  for (const spec of specs) {
    if (spec.required && values[spec.name] === undefined) {
      fail(`error: '${verb}' requires ${spec.name} ${spec.hint}`)
    }
  }

  return values
}

function requiredString(values: Record<string, string | number | undefined>, flag: string): string {
  const value = values[flag]
  if (typeof value !== 'string') fail(`error: ${flag} requires a string value`)
  return value
}

function optionalString(values: Record<string, string | number | undefined>, flag: string): string | undefined {
  const value = values[flag]
  return typeof value === 'string' ? value : undefined
}

function requiredNumber(values: Record<string, string | number | undefined>, flag: string): number {
  const value = values[flag]
  if (typeof value !== 'number') fail(`error: ${flag} requires a numeric value`)
  return value
}

function optionalNumber(values: Record<string, string | number | undefined>, flag: string): number | undefined {
  const value = values[flag]
  return typeof value === 'number' ? value : undefined
}

function resolvedRequiredPath(values: Record<string, string | number | undefined>, flag: string): string {
  return path.resolve(requiredString(values, flag))
}

// ── parseLiveCrudCommand ───────────────────────────────────────────────────

export function parseLiveCrudCommand(verb: LiveCrudVerb, argsForVerb: readonly string[]): ParsedLiveCrudCommand {
  if (argsForVerb.includes('--help')) {
    console.log(liveCrudUsage(verb))
    process.exit(0)
  }
  if (argsForVerb.length === 0) {
    const firstRequired = LIVE_CRUD_FLAGS[verb].find((spec) => spec.required)
    fail(`error: '${verb}' requires ${firstRequired?.name ?? '<flag>'} ${firstRequired?.hint ?? '<value>'}\n${liveCrudUsage(verb)}`)
  }

  const values = parseLiveCrudFlagValues(verb, argsForVerb)
  const vaultPath = optionalString(values, '--vault')

  switch (verb) {
    case 'add-node': {
      const file = resolvedRequiredPath(values, '--file')
      const label = optionalString(values, '--label')
      const defaultHeading = `# ${path.basename(file, '.md')}\n`
      const x = optionalNumber(values, '--x')
      const y = optionalNumber(values, '--y')
      if ((x === undefined) !== (y === undefined)) {
        fail(`error: 'add-node' requires both --x <num> and --y <num> when setting a position`)
      }
      const command: SerializedCommand = {
        type: 'AddNode',
        node: {
          outgoingEdges: [],
          absoluteFilePathIsID: file,
          contentWithoutYamlOrLinks: label !== undefined ? label : defaultHeading,
          nodeUIMetadata: {
            color: {_tag: 'None'},
            position: x !== undefined && y !== undefined ? {_tag: 'Some', value: {x, y}} : {_tag: 'None'},
            additionalYAMLProps: [],
          },
        },
      }
      return {command, ...(vaultPath !== undefined ? {vaultPath} : {})}
    }
    case 'rm-node': {
      const file = resolvedRequiredPath(values, '--file')
      return {command: {type: 'RemoveNode', id: file}, ...(vaultPath !== undefined ? {vaultPath} : {})}
    }
    case 'add-edge': {
      const source = resolvedRequiredPath(values, '--src-file')
      const targetId = resolvedRequiredPath(values, '--tgt-file')
      const label = optionalString(values, '--label') ?? ''
      return {
        command: {type: 'AddEdge', source, edge: {targetId, label}},
        ...(vaultPath !== undefined ? {vaultPath} : {}),
      }
    }
    case 'rm-edge': {
      const source = resolvedRequiredPath(values, '--src-file')
      const targetId = resolvedRequiredPath(values, '--tgt-file')
      return {command: {type: 'RemoveEdge', source, targetId}, ...(vaultPath !== undefined ? {vaultPath} : {})}
    }
    case 'mv-node': {
      const file = resolvedRequiredPath(values, '--file')
      const x = requiredNumber(values, '--x')
      const y = requiredNumber(values, '--y')
      return {command: {type: 'Move', id: file, to: {x, y}}, ...(vaultPath !== undefined ? {vaultPath} : {})}
    }
  }
}

// ── live graph I/O (via daemon) ────────────────────────────────────────────

async function getLoadedRoots(vaultPath?: string): Promise<readonly string[]> {
  // BF-266a: derive loaded roots via hydrateState. Post-UFV the wire shape no longer
  // includes `roots.loaded` — that set is derived from `folderState` rows or the legacy
  // `roots.loaded` fallback by hydrateState. Reading `parsed.roots.loaded` directly
  // returned [] under the new wire shape, which made mv-node a no-op for positions.
  const result = await liveStateDump({pretty: false, ...(vaultPath !== undefined ? {vaultPath} : {})})
  const serialized = JSON.parse(result.json) as SerializedState
  const state = hydrateState(serialized)
  return [...state.roots.loaded]
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

async function writePositionForFile(filePath: string, position: {readonly x: number; readonly y: number}, vaultPath?: string): Promise<void> {
  const root = findLoadedRootForFile(await getLoadedRoots(vaultPath), filePath)
  if (!root) return

  const positionsPath = path.join(root, '.voicetree', 'positions.json')
  const positions = readJsonRecord(positionsPath)
  positions[filePath] = {x: position.x, y: position.y}
  fs.mkdirSync(path.dirname(positionsPath), {recursive: true})
  fs.writeFileSync(positionsPath, `${JSON.stringify(positions, null, 2)}\n`, 'utf8')
}

async function removePositionForFile(filePath: string, vaultPath?: string): Promise<void> {
  const root = findLoadedRootForFile(await getLoadedRoots(vaultPath), filePath)
  if (!root) return

  const positionsPath = path.join(root, '.voicetree', 'positions.json')
  const positions = readJsonRecord(positionsPath)
  delete positions[filePath]
  fs.mkdirSync(path.dirname(positionsPath), {recursive: true})
  fs.writeFileSync(positionsPath, `${JSON.stringify(positions, null, 2)}\n`, 'utf8')
}

export async function getLiveGraphNodes(vaultPath?: string): Promise<LiveGraphNodesSnapshot> {
  const result = await liveStateDump({pretty: false, ...(vaultPath !== undefined ? {vaultPath} : {})})
  const parsed = JSON.parse(result.json) as {
    graph?: {nodes?: Record<string, LiveGraphNodeSnapshot | undefined>}
  }
  return parsed.graph?.nodes ?? {}
}

function hasLiveNode(nodes: LiveGraphNodesSnapshot, nodeId: string): boolean {
  return nodes[nodeId] !== undefined
}

function resolveLiveNodeId(nodes: LiveGraphNodesSnapshot, filePath: string): string {
  return Object.keys(nodes)
    .find((nodeId) => pathIdentitiesOverlap(nodeId, filePath)) ?? filePath
}

function hasLiveEdge(
  nodes: LiveGraphNodesSnapshot,
  source: string,
  targetId: string,
  label?: string,
): boolean {
  return (nodes[source]?.outgoingEdges ?? [])
    .some((edge) => edge.targetId === targetId && (label === undefined || edge.label === label))
}

function nodeHasLivePosition(
  nodes: LiveGraphNodesSnapshot,
  nodeId: string,
  position: {readonly x: number; readonly y: number},
): boolean {
  const livePosition = nodes[nodeId]?.nodeUIMetadata?.position
  return livePosition?._tag === 'Some'
    && livePosition.value?.x === position.x
    && livePosition.value?.y === position.y
}

function deltaMovedPosition(delta: Delta, nodeId: string): boolean {
  return delta.positionsMoved instanceof Map && delta.positionsMoved.has(nodeId)
}

// ── resolution + persistence ───────────────────────────────────────────────

export function resolveCommandNodeIds(
  parsed: ParsedLiveCrudCommand,
  nodes: LiveGraphNodesSnapshot,
): ParsedLiveCrudCommand {
  const command = parsed.command

  switch (command.type) {
    case 'AddNode': {
      const file = resolveLiveNodeId(nodes, command.node.absoluteFilePathIsID)
      return {
        ...parsed,
        command: {
          ...command,
          node: {
            ...command.node,
            absoluteFilePathIsID: file,
          },
        },
      }
    }
    case 'RemoveNode':
      return {...parsed, command: {...command, id: resolveLiveNodeId(nodes, command.id)}}
    case 'AddEdge':
      return {
        ...parsed,
        command: {
          ...command,
          source: resolveLiveNodeId(nodes, command.source),
          edge: {
            ...command.edge,
            targetId: resolveLiveNodeId(nodes, command.edge.targetId),
          },
        },
      }
    case 'RemoveEdge':
      return {
        ...parsed,
        command: {
          ...command,
          source: resolveLiveNodeId(nodes, command.source),
          targetId: resolveLiveNodeId(nodes, command.targetId),
        },
      }
    case 'Move':
      return {...parsed, command: {...command, id: resolveLiveNodeId(nodes, command.id)}}
    default:
      return parsed
  }
}

export async function persistLiveCrudCommand(
  parsed: ParsedLiveCrudCommand,
  delta: Delta,
  beforeNodes: LiveGraphNodesSnapshot,
  afterNodes: LiveGraphNodesSnapshot,
): Promise<void> {
  const command = parsed.command

  switch (command.type) {
    case 'AddNode': {
      const file = command.node.absoluteFilePathIsID
      if (!hasLiveNode(afterNodes, file)) return
      fs.mkdirSync(path.dirname(file), {recursive: true})
      fs.writeFileSync(file, withTrailingNewline(command.node.contentWithoutYamlOrLinks), 'utf8')
      if (command.node.nodeUIMetadata.position._tag === 'Some') {
        await writePositionForFile(file, command.node.nodeUIMetadata.position.value, parsed.vaultPath)
      }
      return
    }
    case 'RemoveNode': {
      if (!hasLiveNode(beforeNodes, command.id) || hasLiveNode(afterNodes, command.id)) return
      if (fs.existsSync(command.id)) fs.rmSync(command.id, {force: true})
      await removePositionForFile(command.id, parsed.vaultPath)
      return
    }
    case 'AddEdge': {
      if (!hasLiveNode(beforeNodes, command.source)
        || !hasLiveEdge(afterNodes, command.source, command.edge.targetId, command.edge.label)
      ) return
      const sourceContent = fs.existsSync(command.source) ? fs.readFileSync(command.source, 'utf8') : ''
      const nextContent = appendLineIfMissing(
        sourceContent,
        edgeLine(command.source, command.edge.targetId, command.edge.label),
      )
      fs.mkdirSync(path.dirname(command.source), {recursive: true})
      fs.writeFileSync(command.source, nextContent, 'utf8')
      return
    }
    case 'RemoveEdge': {
      if (!hasLiveEdge(beforeNodes, command.source, command.targetId)) return
      if (!fs.existsSync(command.source)) return
      const sourceEdges = beforeNodes[command.source]?.outgoingEdges ?? []
      const afterTargetLabels = new Set((afterNodes[command.source]?.outgoingEdges ?? [])
        .filter((edge) => edge.targetId === command.targetId)
        .map((edge) => edge.label ?? ''))
      const sourceEdgeTargetIds = [...new Set(sourceEdges
        .map((edge) => edge.targetId)
        .filter((targetId): targetId is string => typeof targetId === 'string'))]
      const removedEdgeLabels = sourceEdges
        .filter((edge) => edge.targetId === command.targetId)
        .map((edge) => edge.label ?? '')
        .filter((label) => !afterTargetLabels.has(label))
      if (removedEdgeLabels.length === 0) return
      fs.writeFileSync(
        command.source,
        removeEdgeLine(
          fs.readFileSync(command.source, 'utf8'),
          command.source,
          command.targetId,
          sourceEdgeTargetIds,
          removedEdgeLabels,
        ),
        'utf8',
      )
      return
    }
    case 'Move': {
      if (!deltaMovedPosition(delta, command.id) && !nodeHasLivePosition(afterNodes, command.id, command.to)) return
      await writePositionForFile(command.id, command.to, parsed.vaultPath)
      return
    }
    default:
      return
  }
}
