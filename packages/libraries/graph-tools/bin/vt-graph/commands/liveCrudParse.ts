import path from 'node:path'
import type {SerializedCommand} from '@vt/graph-state'
import {fail} from '../shared'

export type LiveCrudVerb = 'add-node' | 'rm-node' | 'add-edge' | 'rm-edge' | 'mv-node'

type FlagKind = 'string' | 'number'

interface FlagSpec {
  readonly name: string
  readonly hint: string
  readonly kind: FlagKind
  readonly required: boolean
}

export interface ParsedLiveCrudCommand {
  readonly command: SerializedCommand
  readonly vaultPath?: string
}

export type ParsedLiveCrudResult =
  | {readonly type: 'help'; readonly text: string}
  | ({readonly type: 'command'} & ParsedLiveCrudCommand)

const LIVE_CRUD_FLAGS: Record<LiveCrudVerb, readonly FlagSpec[]> = {
  'add-node': [
    {name: '--file', hint: '<file-path>', kind: 'string', required: true},
    {name: '--label', hint: '<text>', kind: 'string', required: false},
    {name: '--x', hint: '<num>', kind: 'number', required: false},
    {name: '--y', hint: '<num>', kind: 'number', required: false},
    {name: '--vault', hint: '<path>', kind: 'string', required: false},
  ],
  'rm-node': [
    {name: '--file', hint: '<file-path>', kind: 'string', required: true},
    {name: '--vault', hint: '<path>', kind: 'string', required: false},
  ],
  'add-edge': [
    {name: '--src-file', hint: '<path>', kind: 'string', required: true},
    {name: '--tgt-file', hint: '<path>', kind: 'string', required: true},
    {name: '--label', hint: '<text>', kind: 'string', required: false},
    {name: '--vault', hint: '<path>', kind: 'string', required: false},
  ],
  'rm-edge': [
    {name: '--src-file', hint: '<path>', kind: 'string', required: true},
    {name: '--tgt-file', hint: '<path>', kind: 'string', required: true},
    {name: '--vault', hint: '<path>', kind: 'string', required: false},
  ],
  'mv-node': [
    {name: '--file', hint: '<file-path>', kind: 'string', required: true},
    {name: '--x', hint: '<num>', kind: 'number', required: true},
    {name: '--y', hint: '<num>', kind: 'number', required: true},
    {name: '--vault', hint: '<path>', kind: 'string', required: false},
  ],
}

const LIVE_CRUD_DESCRIPTIONS: Record<LiveCrudVerb, string> = {
  'add-node': 'Adds a node to the live graph. Returns the resulting Delta as JSON.',
  'rm-node': 'Removes a node from the live graph. Returns the resulting Delta as JSON.',
  'add-edge': 'Adds an edge to the live graph. Returns the resulting Delta as JSON.',
  'rm-edge': 'Removes an edge from the live graph. Returns the resulting Delta as JSON.',
  'mv-node': 'Moves a node in the live graph. Returns the resulting Delta as JSON.',
}

export function isLiveCrudVerb(value: string | undefined): value is LiveCrudVerb {
  return value === 'add-node'
    || value === 'rm-node'
    || value === 'add-edge'
    || value === 'rm-edge'
    || value === 'mv-node'
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

export function parseLiveCrudCommand(verb: LiveCrudVerb, argsForVerb: readonly string[]): ParsedLiveCrudResult {
  if (argsForVerb.includes('--help')) {
    return {type: 'help', text: liveCrudUsage(verb)}
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
      return {type: 'command', command, ...(vaultPath !== undefined ? {vaultPath} : {})}
    }
    case 'rm-node': {
      const file = resolvedRequiredPath(values, '--file')
      return {type: 'command', command: {type: 'RemoveNode', id: file}, ...(vaultPath !== undefined ? {vaultPath} : {})}
    }
    case 'add-edge': {
      const source = resolvedRequiredPath(values, '--src-file')
      const targetId = resolvedRequiredPath(values, '--tgt-file')
      const label = optionalString(values, '--label') ?? ''
      return {
        type: 'command',
        command: {type: 'AddEdge', source, edge: {targetId, label}},
        ...(vaultPath !== undefined ? {vaultPath} : {}),
      }
    }
    case 'rm-edge': {
      const source = resolvedRequiredPath(values, '--src-file')
      const targetId = resolvedRequiredPath(values, '--tgt-file')
      return {type: 'command', command: {type: 'RemoveEdge', source, targetId}, ...(vaultPath !== undefined ? {vaultPath} : {})}
    }
    case 'mv-node': {
      const file = resolvedRequiredPath(values, '--file')
      const x = requiredNumber(values, '--x')
      const y = requiredNumber(values, '--y')
      return {type: 'command', command: {type: 'Move', id: file, to: {x, y}}, ...(vaultPath !== undefined ? {vaultPath} : {})}
    }
  }
}
