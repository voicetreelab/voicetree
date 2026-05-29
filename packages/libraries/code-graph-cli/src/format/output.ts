/**
 * Pure output formatters.
 *
 * Two formats:
 *   - "json"  (default): JSON.stringify with 2-space indent. Pipeable into jq.
 *   - "human": one record per line as `id  fanIn/fanOut  loc  exported?`
 *             — easy to skim from a terminal.
 *
 * No I/O: returns a string. The shell (bin/cgcli.ts) is responsible for
 * writing to stdout. Keeps every consumer of this module testable without
 * mocking process streams.
 */
import type {FunctionNode} from '../graph/load-graph.ts'

export type OutputFormat = 'json' | 'human'

export type FunctionSummary = {
    readonly id: string
    readonly file: string
    readonly line: number
    readonly name: string
    readonly kind: FunctionNode['kind']
    readonly isExported: boolean
    readonly loc: number
}

export function summarize(node: FunctionNode): FunctionSummary {
    return {
        id: node.id,
        file: node.file,
        line: node.line,
        name: node.name,
        kind: node.kind,
        isExported: node.isExported,
        loc: node.loc,
    }
}

export function format(value: unknown, fmt: OutputFormat): string {
    if (fmt === 'json') return JSON.stringify(value, null, 2)
    return formatHuman(value)
}

function formatHuman(value: unknown): string {
    if (Array.isArray(value)) return value.map(formatRow).join('\n')
    if (value && typeof value === 'object') return formatRow(value)
    return String(value)
}

function formatRow(value: unknown): string {
    if (value === null || typeof value !== 'object') return String(value)
    const v = value as Record<string, unknown>
    if (typeof v.id !== 'string') return JSON.stringify(value)
    return v.id + numericPart(v, 'fanIn', 'in') + numericPart(v, 'fanOut', 'out')
        + numericPart(v, 'reachableSize', 'reach') + numericPart(v, 'loc', 'loc')
        + (v.isExported ? ' [exported]' : '')
}

function numericPart(v: Record<string, unknown>, key: string, label: string): string {
    const raw = v[key]
    return typeof raw === 'number' ? ` ${label}=${raw}` : ''
}
