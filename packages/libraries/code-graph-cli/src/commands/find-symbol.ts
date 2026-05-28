/**
 * Locate all functions whose name matches a query.
 *
 * Match modes:
 *   - exact (default): name === query
 *   - prefix: name.startsWith(query)
 *   - regex: name matches a JS RegExp built from the query
 *
 * Returns the full set sorted by file, then line. Useful when the agent
 * has a name from grep/recall but needs a stable `file:line:name` id to
 * feed into callers/callees.
 */
import type {CallGraph} from '../graph/load-graph.ts'
import {summarize, type FunctionSummary} from '../format/output.ts'

export type FindSymbolMode = 'exact' | 'prefix' | 'regex'

export function findSymbol(
    graph: CallGraph,
    query: string,
    mode: FindSymbolMode = 'exact',
): readonly FunctionSummary[] {
    const matcher = buildMatcher(query, mode)
    const matches = [...graph.nodes.values()].filter(n => matcher(n.name))
    matches.sort(compareByFileLine)
    return matches.map(summarize)
}

function buildMatcher(query: string, mode: FindSymbolMode): (name: string) => boolean {
    if (mode === 'exact') return name => name === query
    if (mode === 'prefix') return name => name.startsWith(query)
    const re = new RegExp(query)
    return name => re.test(name)
}

function compareByFileLine(a: {file: string; line: number}, b: {file: string; line: number}): number {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return a.line - b.line
}
