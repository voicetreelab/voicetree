import path from 'node:path'
import {computeComplexityFromProject, type GraphComplexityResult} from '@vt/graph-tools/node-runtime'
import {error, handleCliError, output} from '../cliDeps'

function formatHuman(r: GraphComplexityResult): string {
    const lines: string[] = []
    const g = r.graph
    lines.push(`Graph complexity — score ${r.score} (${r.rating.toUpperCase()})${r.cyclic ? '  ⚠ cyclic' : ''}`)
    lines.push(`  ${g.nodes} nodes · ${g.edgesDirected} directed edges · ${g.edgesUndirected} undirected${g.bipartite ? ' · bipartite' : ''}`)
    lines.push('')
    const mark = (s: string): string => (s === 'fail' ? '✗' : s === 'warn' ? '~' : '·')
    for (const p of r.pillars) {
        const role = p.role === 'flag' ? '  [flag]' : `  ${p.normalized}× budget`
        lines.push(`  ${mark(p.status)} ${p.label.padEnd(10)} ${String(p.value).padStart(5)}${role}`)
        lines.push(`      ${p.detail}`)
    }
    lines.push('')
    lines.push('  score = L∞ over the 4 scored pillars (no weighted sum); cycles is an integrity flag.')
    return lines.join('\n')
}

export async function graphComplexity(terminalId: string | undefined, args: string[]): Promise<void> {
    void terminalId

    let folderPath: string | undefined
    for (const arg of args) {
        if (arg === '--json') continue
        if (arg.startsWith('--')) error(`Unknown argument: ${arg}`)
        if (folderPath !== undefined) error(`Unexpected argument: ${arg}`)
        folderPath = arg
    }

    try {
        const resolved: string = path.resolve(folderPath ?? process.cwd())
        const result: GraphComplexityResult = computeComplexityFromProject(resolved)
        output(result, formatHuman)
    } catch (toolError: unknown) {
        handleCliError(toolError)
    }
}
