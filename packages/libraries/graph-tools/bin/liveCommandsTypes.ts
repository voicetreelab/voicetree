// Types + flag tables for `vt-graph live` subcommands.
// Extracted from vt-graph.ts during Step 7c (UDS migration) — the file
// crossed the 500-line ceiling and needed an extraction; pulling out live
// concerns into their own modules also makes the CLI dispatcher easier to
// reason about. Live subcommand parsing/dispatch consumes this module.
import type {SerializedCommand} from '@vt/graph-state'

export type LiveCrudVerb = 'add-node' | 'rm-node' | 'add-edge' | 'rm-edge' | 'mv-node'

export type FlagKind = 'string' | 'number'

export interface FlagSpec {
  readonly name: string
  readonly hint: string
  readonly kind: FlagKind
  readonly required: boolean
}

export interface ParsedLiveCrudCommand {
  readonly command: SerializedCommand
  readonly projectPath?: string
}

export interface LiveGraphNodeSnapshot {
  readonly outgoingEdges?: readonly {readonly targetId?: string; readonly label?: string}[]
  readonly nodeUIMetadata?: {
    readonly position?: {
      readonly _tag?: string
      readonly value?: {readonly x?: number; readonly y?: number}
    }
  }
}

export type LiveGraphNodesSnapshot = Record<string, LiveGraphNodeSnapshot | undefined>

export const LIVE_CRUD_FLAGS: Record<LiveCrudVerb, readonly FlagSpec[]> = {
  'add-node': [
    {name: '--file', hint: '<file-path>', kind: 'string', required: true},
    {name: '--label', hint: '<text>', kind: 'string', required: false},
    {name: '--x', hint: '<num>', kind: 'number', required: false},
    {name: '--y', hint: '<num>', kind: 'number', required: false},
    {name: '--project', hint: '<path>', kind: 'string', required: false},
  ],
  'rm-node': [
    {name: '--file', hint: '<file-path>', kind: 'string', required: true},
    {name: '--project', hint: '<path>', kind: 'string', required: false},
  ],
  'add-edge': [
    {name: '--src-file', hint: '<path>', kind: 'string', required: true},
    {name: '--tgt-file', hint: '<path>', kind: 'string', required: true},
    {name: '--label', hint: '<text>', kind: 'string', required: false},
    {name: '--project', hint: '<path>', kind: 'string', required: false},
  ],
  'rm-edge': [
    {name: '--src-file', hint: '<path>', kind: 'string', required: true},
    {name: '--tgt-file', hint: '<path>', kind: 'string', required: true},
    {name: '--project', hint: '<path>', kind: 'string', required: false},
  ],
  'mv-node': [
    {name: '--file', hint: '<file-path>', kind: 'string', required: true},
    {name: '--x', hint: '<num>', kind: 'number', required: true},
    {name: '--y', hint: '<num>', kind: 'number', required: true},
    {name: '--project', hint: '<path>', kind: 'string', required: false},
  ],
}

export const LIVE_CRUD_DESCRIPTIONS: Record<LiveCrudVerb, string> = {
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

export function flagUsage(spec: FlagSpec): string {
  const hint = spec.kind === 'number'
    ? spec.hint.replace('<num>', '<number>')
    : spec.hint
      .replace('<file-path>', '<path>')
      .replace('<text>', '<string>')
  const usageText = `${spec.name} ${hint}`
  return spec.required ? usageText : `[${usageText}]`
}

export function liveCrudUsage(verb: LiveCrudVerb): string {
  return [
    `Usage: vt-graph live ${verb} ${LIVE_CRUD_FLAGS[verb].map(flagUsage).join(' ')}`,
    `  ${LIVE_CRUD_DESCRIPTIONS[verb]}`,
  ].join('\n')
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
