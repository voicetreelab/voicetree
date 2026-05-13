#!/usr/bin/env npx tsx
import fs from 'node:fs'
import path from 'node:path'
import {
  dumpState,
  formatLintReportHuman,
  formatLintReportJson,
  graphStateApply,
  graphMove,
  graphRename,
  lintGraphWithFixes,
  liveStateDump,
  liveApply,
  liveView,
  liveFocus,
  liveNeighbors,
  livePath,
  type ViewFormat,
} from '../src/node'
import {
  runHygieneAudit,
  formatHygieneReportHuman,
  formatHygieneReportJson,
  type HygieneRuleId,
} from '../src/hygiene'
import type {Delta, SerializedCommand} from '@vt/graph-state'
import {linkMatchScore} from '@vt/graph-model'
import {parseStateDumpArgs} from './cliArgs'
import {runStructureCommand} from './structureCommand'

const [,, command, ...args] = process.argv

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function usage(): string {
  return [
    'Usage: vt-graph <lint|hygiene|structure|apply|rename|mv|state|live> [args]',
    '       vt-graph hygiene <vault> [--rule <id>] [--json]',
    '       vt-graph structure [folder] [--budget N] [--no-auto|--ascii|--mermaid] [--collapse F]... [--select X]... [--port N]',
    '         (default: tree-cover with daemon overlay if available; auto-collapses coherent subgraphs once visible entities exceed budget — default 30)',
    '       vt-graph apply <cmd-json> [--state-file <path>] [--pretty|--no-pretty] [--out <file>]',
    '       vt-graph state dump <root> [--pretty|--no-pretty] [--out <file>]',
    '       vt-graph live view [--collapse F]... [--select X]... [--mermaid] [--port N]',
    '       vt-graph live state dump [--no-pretty] [--port N]',
    '       vt-graph live apply \'<json-cmd>\' [--port N]',
    '       vt-graph live add-node --file <path> [--label <string>] [--x <number>] [--y <number>] [--port <number>]',
    '       vt-graph live rm-node --file <path> [--port <number>]',
    '       vt-graph live add-edge --src-file <path> --tgt-file <path> [--label <string>] [--port <number>]',
    '       vt-graph live rm-edge --src-file <path> --tgt-file <path> [--port <number>]',
    '       vt-graph live mv-node --file <path> --x <number> --y <number> [--port <number>]',
    '       vt-graph live focus <node> [--hops N] [--port N]',
    '       vt-graph live neighbors <node> [--hops N] [--port N]',
    '       vt-graph live path <a> <b> [--port N]',
  ].join('\n')
}

function getRequiredValue(parsedArgs: string[], index: number, flag: string): string {
  const value: string | undefined = parsedArgs[index]
  if (!value || value.startsWith('--')) {
    fail(`${flag} requires a value`)
  }

  return value
}

type LiveCrudVerb = 'add-node' | 'rm-node' | 'add-edge' | 'rm-edge' | 'mv-node'

type FlagKind = 'string' | 'number'

interface FlagSpec {
  readonly name: string
  readonly hint: string
  readonly kind: FlagKind
  readonly required: boolean
}

interface ParsedLiveCrudCommand {
  readonly command: SerializedCommand
  readonly port?: number
}

interface LiveGraphNodeSnapshot {
  readonly outgoingEdges?: readonly {readonly targetId?: string; readonly label?: string}[]
  readonly nodeUIMetadata?: {
    readonly position?: {
      readonly _tag?: string
      readonly value?: {readonly x?: number; readonly y?: number}
    }
  }
}

type LiveGraphNodesSnapshot = Record<string, LiveGraphNodeSnapshot | undefined>

const LIVE_CRUD_FLAGS: Record<LiveCrudVerb, readonly FlagSpec[]> = {
  'add-node': [
    {name: '--file', hint: '<file-path>', kind: 'string', required: true},
    {name: '--label', hint: '<text>', kind: 'string', required: false},
    {name: '--x', hint: '<num>', kind: 'number', required: false},
    {name: '--y', hint: '<num>', kind: 'number', required: false},
    {name: '--port', hint: '<num>', kind: 'number', required: false},
  ],
  'rm-node': [
    {name: '--file', hint: '<file-path>', kind: 'string', required: true},
    {name: '--port', hint: '<num>', kind: 'number', required: false},
  ],
  'add-edge': [
    {name: '--src-file', hint: '<path>', kind: 'string', required: true},
    {name: '--tgt-file', hint: '<path>', kind: 'string', required: true},
    {name: '--label', hint: '<text>', kind: 'string', required: false},
    {name: '--port', hint: '<num>', kind: 'number', required: false},
  ],
  'rm-edge': [
    {name: '--src-file', hint: '<path>', kind: 'string', required: true},
    {name: '--tgt-file', hint: '<path>', kind: 'string', required: true},
    {name: '--port', hint: '<num>', kind: 'number', required: false},
  ],
  'mv-node': [
    {name: '--file', hint: '<file-path>', kind: 'string', required: true},
    {name: '--x', hint: '<num>', kind: 'number', required: true},
    {name: '--y', hint: '<num>', kind: 'number', required: true},
    {name: '--port', hint: '<num>', kind: 'number', required: false},
  ],
}

const LIVE_CRUD_DESCRIPTIONS: Record<LiveCrudVerb, string> = {
  'add-node': 'Adds a node to the live graph. Returns the resulting Delta as JSON.',
  'rm-node': 'Removes a node from the live graph. Returns the resulting Delta as JSON.',
  'add-edge': 'Adds an edge to the live graph. Returns the resulting Delta as JSON.',
  'rm-edge': 'Removes an edge from the live graph. Returns the resulting Delta as JSON.',
  'mv-node': 'Moves a node in the live graph. Returns the resulting Delta as JSON.',
}

function isLiveCrudVerb(value: string | undefined): value is LiveCrudVerb {
  return value === 'add-node'
    || value === 'rm-node'
    || value === 'add-edge'
    || value === 'rm-edge'
    || value === 'mv-node'
}

function liveUsage(): string {
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

function flagUsage(spec: FlagSpec): string {
  const hint = spec.kind === 'number'
    ? spec.hint.replace('<num>', '<number>')
    : spec.hint
      .replace('<file-path>', '<path>')
      .replace('<text>', '<string>')
  const usageText = `${spec.name} ${hint}`
  return spec.required ? usageText : `[${usageText}]`
}

function liveCrudUsage(verb: LiveCrudVerb): string {
  return [
    `Usage: vt-graph live ${verb} ${LIVE_CRUD_FLAGS[verb].map(flagUsage).join(' ')}`,
    `  ${LIVE_CRUD_DESCRIPTIONS[verb]}`,
  ].join('\n')
}

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
  const specByName = new Map(specs.map((spec) => [spec.name, spec]))
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

function withTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function markdownLinkTarget(sourceFile: string, targetFile: string): string {
  const relativePath = path.relative(path.dirname(sourceFile), targetFile).replaceAll(path.sep, '/')
  return relativePath.replace(/\.md$/, '')
}

function edgeLine(sourceFile: string, targetFile: string, label: string): string {
  const link = `[[${markdownLinkTarget(sourceFile, targetFile)}]]`
  return label ? `${label} ${link}` : link
}

function appendLineIfMissing(content: string, line: string): string {
  const lines = content.split(/\r?\n/)
  if (lines.includes(line)) return content
  return `${withTrailingNewline(content)}${line}\n`
}

const WIKILINK_PATTERN = /\[\[([^\]\r\n]+)\]\]/g

function linkReferencesTarget(linkText: string, sourceFile: string, targetFile: string): boolean {
  const targetAbsolute = path.resolve(targetFile)
  const relativeWithExtension = linkText.endsWith('.md') ? linkText : `${linkText}.md`
  const resolvedRelative = path.resolve(path.dirname(sourceFile), relativeWithExtension)

  return resolvedRelative === targetAbsolute || linkMatchScore(linkText, targetAbsolute) > 0
}

function lineReferencesTarget(line: string, sourceFile: string, targetFile: string): boolean {
  return [...line.matchAll(WIKILINK_PATTERN)]
    .some((match) => linkReferencesTarget(match[1] ?? '', sourceFile, targetFile))
}

function removeEdgeLine(content: string, sourceFile: string, targetFile: string): string {
  const nextLines = content.split(/\r?\n/)
    .filter((line) => !lineReferencesTarget(line, sourceFile, targetFile))
  return withTrailingNewline(nextLines.join('\n').replace(/\n+$/, ''))
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

function findLoadedRootForFile(loadedRoots: readonly string[], filePath: string): string | undefined {
  const resolvedFile = path.resolve(filePath)
  return [...loadedRoots]
    .map((root) => path.resolve(root))
    .filter((root) => resolvedFile === root || resolvedFile.startsWith(`${root}${path.sep}`))
    .sort((left, right) => right.length - left.length)[0]
}

async function getLoadedRoots(port?: number): Promise<readonly string[]> {
  const result = await liveStateDump({pretty: false, ...(port !== undefined ? {port} : {})})
  const parsed = JSON.parse(result.json) as {roots?: {loaded?: unknown}}
  return Array.isArray(parsed.roots?.loaded)
    ? parsed.roots.loaded.filter((root): root is string => typeof root === 'string')
    : []
}

async function writePositionForFile(filePath: string, position: {readonly x: number; readonly y: number}, port?: number): Promise<void> {
  const root = findLoadedRootForFile(await getLoadedRoots(port), filePath)
  if (!root) return

  const positionsPath = path.join(root, '.voicetree', 'positions.json')
  const positions = readJsonRecord(positionsPath)
  positions[filePath] = {x: position.x, y: position.y}
  fs.mkdirSync(path.dirname(positionsPath), {recursive: true})
  fs.writeFileSync(positionsPath, `${JSON.stringify(positions, null, 2)}\n`, 'utf8')
}

async function removePositionForFile(filePath: string, port?: number): Promise<void> {
  const root = findLoadedRootForFile(await getLoadedRoots(port), filePath)
  if (!root) return

  const positionsPath = path.join(root, '.voicetree', 'positions.json')
  const positions = readJsonRecord(positionsPath)
  delete positions[filePath]
  fs.mkdirSync(path.dirname(positionsPath), {recursive: true})
  fs.writeFileSync(positionsPath, `${JSON.stringify(positions, null, 2)}\n`, 'utf8')
}

async function getLiveGraphNodes(port?: number): Promise<LiveGraphNodesSnapshot> {
  const result = await liveStateDump({pretty: false, ...(port !== undefined ? {port} : {})})
  const parsed = JSON.parse(result.json) as {
    graph?: {nodes?: Record<string, LiveGraphNodeSnapshot | undefined>}
  }
  return parsed.graph?.nodes ?? {}
}

function hasLiveNode(nodes: LiveGraphNodesSnapshot, nodeId: string): boolean {
  return nodes[nodeId] !== undefined
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

function parseLiveCrudCommand(verb: LiveCrudVerb, argsForVerb: readonly string[]): ParsedLiveCrudCommand {
  if (argsForVerb.includes('--help')) {
    console.log(liveCrudUsage(verb))
    process.exit(0)
  }
  if (argsForVerb.length === 0) {
    const firstRequired = LIVE_CRUD_FLAGS[verb].find((spec) => spec.required)
    fail(`error: '${verb}' requires ${firstRequired?.name ?? '<flag>'} ${firstRequired?.hint ?? '<value>'}\n${liveCrudUsage(verb)}`)
  }

  const values = parseLiveCrudFlagValues(verb, argsForVerb)
  const port = optionalNumber(values, '--port')

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
      return {command, ...(port !== undefined ? {port} : {})}
    }
    case 'rm-node': {
      const file = resolvedRequiredPath(values, '--file')
      return {command: {type: 'RemoveNode', id: file}, ...(port !== undefined ? {port} : {})}
    }
    case 'add-edge': {
      const source = resolvedRequiredPath(values, '--src-file')
      const targetId = resolvedRequiredPath(values, '--tgt-file')
      const label = optionalString(values, '--label') ?? ''
      return {
        command: {type: 'AddEdge', source, edge: {targetId, label}},
        ...(port !== undefined ? {port} : {}),
      }
    }
    case 'rm-edge': {
      const source = resolvedRequiredPath(values, '--src-file')
      const targetId = resolvedRequiredPath(values, '--tgt-file')
      return {command: {type: 'RemoveEdge', source, targetId}, ...(port !== undefined ? {port} : {})}
    }
    case 'mv-node': {
      const file = resolvedRequiredPath(values, '--file')
      const x = requiredNumber(values, '--x')
      const y = requiredNumber(values, '--y')
      return {command: {type: 'Move', id: file, to: {x, y}}, ...(port !== undefined ? {port} : {})}
    }
  }
}

function deltaMovedPosition(delta: Delta, nodeId: string): boolean {
  return delta.positionsMoved instanceof Map && delta.positionsMoved.has(nodeId)
}

async function persistLiveCrudCommand(
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
        await writePositionForFile(file, command.node.nodeUIMetadata.position.value, parsed.port)
      }
      return
    }
    case 'RemoveNode': {
      if (!hasLiveNode(beforeNodes, command.id) || hasLiveNode(afterNodes, command.id)) return
      if (fs.existsSync(command.id)) fs.rmSync(command.id, {force: true})
      await removePositionForFile(command.id, parsed.port)
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
      if (!hasLiveEdge(beforeNodes, command.source, command.targetId)
        || hasLiveEdge(afterNodes, command.source, command.targetId)
      ) return
      if (!fs.existsSync(command.source)) return
      fs.writeFileSync(
        command.source,
        removeEdgeLine(fs.readFileSync(command.source, 'utf8'), command.source, command.targetId),
        'utf8',
      )
      return
    }
    case 'Move': {
      if (!deltaMovedPosition(delta, command.id) && !nodeHasLivePosition(afterNodes, command.id, command.to)) return
      await writePositionForFile(command.id, command.to, parsed.port)
      return
    }
    default:
      return
  }
}


async function main(): Promise<void> {
  switch (command) {
    case 'lint': {
      let folderPath: string | undefined
      let jsonFlag = false
      let fixFlag = false

      for (const arg of args) {
        if (arg === '--json') {
          jsonFlag = true
          continue
        }

        if (arg === '--fix') {
          fixFlag = true
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

      const report = lintGraphWithFixes({
        folderPath: folderPath || process.cwd(),
        applyFixes: fixFlag,
        agentName: process.env.AGENT_NAME,
      })
      console.log(jsonFlag ? formatLintReportJson(report) : formatLintReportHuman(report))
      break
    }
    case 'structure': {
      await runStructureCommand(args)
      break
    }
    case 'rename': {
      await graphRename(0, undefined, args)
      break
    }
    case 'mv': {
      await graphMove(0, undefined, args)
      break
    }
    case 'apply': {
      await graphStateApply(args)
      break
    }
    case 'state': {
      const [subcommand, ...stateArgs] = args
      if (subcommand !== 'dump') {
        fail('Usage: vt-graph state dump <root> [--pretty|--no-pretty] [--out <file>]')
      }

      const parsed = parseStateDumpArgs(stateArgs)
      const result = await dumpState(parsed.rootPath, {
        pretty: parsed.pretty,
        outFile: parsed.outFile,
      })
      process.stdout.write(result.json)
      break
    }
    case 'live': {
      const [liveSubcommand, ...liveArgs] = args

      if (!liveSubcommand || liveSubcommand === '--help') {
        console.log(liveUsage())
        break
      }

      if (liveSubcommand === 'view') {
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
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) {
            port = parseInt(arg.slice('--port='.length), 10)
            continue
          }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        }

        const result = await liveView({format, collapsedFolders, selectedIds, port})
        console.log(result.output)
        if (format === 'ascii') {
          console.log(`\n${result.nodeCount} nodes — ${result.folderNodeCount} folder nodes, ${result.virtualFolderCount} virtual folders, ${result.fileNodeCount} files`)
        }
        break
      }

      if (liveSubcommand === 'state') {
        const [stateSubcmd, ...stateArgs] = liveArgs
        if (stateSubcmd !== 'dump') {
          fail('Usage: vt-graph live state dump [--no-pretty] [--port N]')
        }
        let pretty = true
        let port: number | undefined
        for (let i = 0; i < stateArgs.length; i++) {
          const arg = stateArgs[i]
          if (arg === '--pretty') { pretty = true; continue }
          if (arg === '--no-pretty') { pretty = false; continue }
          if (arg === '--port') {
            const next = stateArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) {
            port = parseInt(arg.slice('--port='.length), 10)
            continue
          }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        }
        const result = await liveStateDump({pretty, port})
        process.stdout.write(result.json)
        break
      }

      if (liveSubcommand === 'apply') {
        let cmdJson: string | undefined
        let port: number | undefined
        for (let i = 0; i < liveArgs.length; i++) {
          const arg = liveArgs[i]
          if (arg === '--port') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
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
        const result = await liveApply(cmdJson, {port})
        process.stdout.write(result.output)
        break
      }

      if (isLiveCrudVerb(liveSubcommand)) {
        const parsed = parseLiveCrudCommand(liveSubcommand, liveArgs)
        const beforeNodes = await getLiveGraphNodes(parsed.port)
        const result = await liveApply(JSON.stringify(parsed.command), {port: parsed.port})
        const afterNodes = await getLiveGraphNodes(parsed.port)
        await persistLiveCrudCommand(parsed, result.delta, beforeNodes, afterNodes)
        process.stdout.write(result.output)
        break
      }

      if (liveSubcommand === 'focus') {
        const nodeId = liveArgs[0]
        if (!nodeId || nodeId.startsWith('--')) fail('Usage: vt-graph live focus <node> [--hops N] [--port N]')
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
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) { port = parseInt(arg.slice('--port='.length), 10); continue }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        }
        console.log(await liveFocus(nodeId, {hops, port}))
        break
      }

      if (liveSubcommand === 'neighbors') {
        const nodeId = liveArgs[0]
        if (!nodeId || nodeId.startsWith('--')) fail('Usage: vt-graph live neighbors <node> [--hops N] [--port N]')
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
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) { port = parseInt(arg.slice('--port='.length), 10); continue }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        }
        console.log(await liveNeighbors(nodeId, {hops, port}))
        break
      }

      if (liveSubcommand === 'path') {
        const nodeA = liveArgs[0]
        const nodeB = liveArgs[1]
        if (!nodeA || nodeA.startsWith('--') || !nodeB || nodeB.startsWith('--')) {
          fail('Usage: vt-graph live path <a> <b> [--port N]')
        }
        let port: number | undefined
        for (let i = 2; i < liveArgs.length; i++) {
          const arg = liveArgs[i]
          if (arg === '--port') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) { port = parseInt(arg.slice('--port='.length), 10); continue }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        }
        console.log(await livePath(nodeA, nodeB, {port}))
        break
      }

      fail(`error: unknown live subcommand "${liveSubcommand}"\n${liveUsage()}`)
      break
    }

    case 'hygiene': {
      let vaultPath: string | undefined
      let ruleFilter: HygieneRuleId | undefined
      let jsonFlag = false

      const VALID_RULES: HygieneRuleId[] = ['max_wikilinks_per_node', 'max_tree_width', 'canonical_hierarchy']

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]

        if (arg === '--json') { jsonFlag = true; continue }

        if (arg === '--rule') {
          const val = getRequiredValue(args, i + 1, '--rule')
          if (!VALID_RULES.includes(val as HygieneRuleId)) {
            fail(`Unknown rule: ${val}. Valid rules: ${VALID_RULES.join(', ')}`)
          }
          ruleFilter = val as HygieneRuleId
          i += 1
          continue
        }

        if (arg.startsWith('--rule=')) {
          const val = arg.slice('--rule='.length)
          if (!VALID_RULES.includes(val as HygieneRuleId)) {
            fail(`Unknown rule: ${val}. Valid rules: ${VALID_RULES.join(', ')}`)
          }
          ruleFilter = val as HygieneRuleId
          continue
        }

        if (arg.startsWith('--')) { fail(`Unknown argument: ${arg}`) }

        if (vaultPath !== undefined) { fail(`Unexpected argument: ${arg}`) }
        vaultPath = arg
      }

      if (!vaultPath) {
        fail('Usage: vt-graph hygiene <vault-path> [--rule <id>] [--json]')
      }

      const report = runHygieneAudit(vaultPath, {rule: ruleFilter})
      console.log(jsonFlag ? formatHygieneReportJson(report) : formatHygieneReportHuman(report))
      if (report.summary.totalErrors > 0) process.exit(1)
      break
    }

    default:
      console.log(usage())
      process.exit(1)
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
