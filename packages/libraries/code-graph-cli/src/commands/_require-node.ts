import type {CallGraph} from '../graph/load-graph.ts'

export function requireNode(graph: CallGraph, fnId: string): void {
    if (graph.nodes.has(fnId)) return
    throw new Error(
        `Unknown function id: ${fnId}\n` +
        `Expected format: file:line:name (try \`cgcli find-symbol <name>\`).`,
    )
}
