import {dirname} from 'node:path'
import {describe, it} from 'vitest'
import {discoverPackages} from '../../_shared/discovery/discover-packages'
import {buildImportGraph} from '../../_shared/graph/import-graph'
import {formSiblingGroups, type CommunityReport, type SiblingGroupReport} from '../../_shared/complexity/orange-priority.ts'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

// --- Report Formatting ---

function formatGroupReport(group: SiblingGroupReport): string {
    const lines: string[] = []
    lines.push(`\n  Sibling Group: ${group.parentId} (${group.communityCount} communities, ${group.fileCount} files, ${group.crossEdgeCount} cross-edges)`)

    lines.push('    Boundary Width:')
    for (const c of [...group.communities].sort((a, b) => b.boundaryWidth - a.boundaryWidth)) {
        const shortName = c.id.split('/').pop()!
        const bar = '█'.repeat(Math.round(c.boundaryWidth * 20))
        lines.push(`      ${shortName.padEnd(20)} ${String(c.boundaryFileCount).padStart(3)}/${String(c.fileCount).padEnd(3)} = ${c.boundaryWidth.toFixed(3)} ${bar}`)
    }

    lines.push(`    Tree-Width (MCS): ${group.treeWidth}`)
    lines.push(`    Normalized Entropy: ${group.normalizedEntropy.toFixed(3)}`)
    lines.push(`    Modularity Q: ${group.modularityQ.toFixed(3)}`)

    const maxNameLen = Math.max(...group.dsm.names.map(n => n.length), 3)
    const colWidth = Math.max(maxNameLen, 4)
    lines.push(`    DSM:`)
    const header = '      ' + ''.padEnd(colWidth + 1) + group.dsm.names.map(n => n.slice(0, colWidth).padStart(colWidth)).join(' ')
    lines.push(header)
    for (let i = 0; i < group.dsm.names.length; i++) {
        const row = group.dsm.matrix[i]
        const cells = row.map((v, j) => i === j ? '—'.padStart(colWidth) : String(v).padStart(colWidth))
        lines.push(`      ${group.dsm.names[i].slice(0, colWidth).padEnd(colWidth + 1)}${cells.join(' ')}`)
    }

    return lines.join('\n')
}

// --- Test ---

describe('hierarchical complexity', () => {
    it('reports complexity at all directory containment levels', async () => {
        const packages = await discoverPackages()
        const graph = await buildImportGraph(packages)

        const maxDepth = Math.max(...graph.files.map(f => {
            const dir = dirname(f.relToSrc)
            return dir === '.' ? 0 : dir.split('/').length
        }))

        const output: string[] = ['']

        for (let depth = 1; depth <= maxDepth; depth++) {
            const groups = formSiblingGroups(graph.files, graph.edges, depth)
            if (groups.length === 0) continue

            output.push(`\n${'='.repeat(60)}`)
            output.push(`DEPTH ${depth}: ${depth === 1 ? 'Subdirectory' : `Sub${'sub'.repeat(depth - 1)}directory`}-Level Complexity`)
            output.push('='.repeat(60))

            for (const group of groups) {
                output.push(formatGroupReport(group))
            }

            const worstBW = Math.max(...groups.map(g => Math.max(...g.communities.map(c => c.boundaryWidth))))
            const worstTW = Math.max(...groups.map(g => g.treeWidth))
            const meanEntropy = groups.reduce((s, g) => s + g.normalizedEntropy, 0) / groups.length
            const meanModularityQ = groups.reduce((s, g) => s + g.modularityQ, 0) / groups.length

            output.push(`\n  --- Depth ${depth} Summary ---`)
            output.push(`  Worst boundary width: ${worstBW.toFixed(3)}`)
            output.push(`  Worst tree-width:     ${worstTW}`)
            output.push(`  Mean norm. entropy:   ${meanEntropy.toFixed(3)}`)
            output.push(`  Mean Modularity Q:    ${meanModularityQ.toFixed(3)}`)
        }

        output.push(`\n${'='.repeat(80)}`)
        output.push('RANKING: All communities sorted by boundary width (encapsulation)')
        output.push('='.repeat(80))
        output.push('  BW = boundary_files / total_files')
        output.push('  1.0 = every file crosses boundaries (no encapsulation)')
        output.push('  0.0 = fully internal (perfect encapsulation)\n')

        const allCommunities: { community: CommunityReport; parentId: string; depth: number }[] = []
        for (let depth = 1; depth <= maxDepth; depth++) {
            const groups = formSiblingGroups(graph.files, graph.edges, depth)
            for (const group of groups) {
                for (const c of group.communities) {
                    allCommunities.push({community: c, parentId: group.parentId, depth: group.depth})
                }
            }
        }

        allCommunities.sort((a, b) => {
            const bwDiff = b.community.boundaryWidth - a.community.boundaryWidth
            if (Math.abs(bwDiff) > 0.001) return bwDiff
            return b.community.boundaryFileCount - a.community.boundaryFileCount
        })

        output.push('  ' + [
            '#'.padStart(3),
            'Community'.padEnd(42),
            'Files'.padStart(5),
            'Boundary'.padStart(8),
            'BW'.padStart(6),
            'Bar',
        ].join(' '))
        output.push('  ' + '─'.repeat(80))

        for (const [i, entry] of allCommunities.entries()) {
            const c = entry.community
            const shortId = c.id.replace(/^[^/]+\//, '')
            const bar = '█'.repeat(Math.round(c.boundaryWidth * 20))
            output.push('  ' + [
                String(i + 1).padStart(3),
                `${entry.parentId}/${shortId}`.padEnd(42),
                String(c.fileCount).padStart(5),
                `${c.boundaryFileCount}/${c.fileCount}`.padStart(8),
                c.boundaryWidth.toFixed(3).padStart(6),
                bar,
            ].join(' '))
        }

        // Priority ranking — BW critique fix: outgoing coupling × spread.
        // Stable cores (outEdges=0) are healthy and excluded by design.
        type Priority = { community: CommunityReport; parentId: string; depth: number; score: number }
        const priorityRanked: Priority[] = allCommunities
            .filter(e => e.community.outEdges > 0)
            .map(e => ({...e, score: e.community.outEdges * Math.max(1, e.community.fanOut)}))
            .sort((a, b) => b.score - a.score)

        output.push('')
        output.push('='.repeat(80))
        output.push('PRIORITY TO IMPROVE — top communities by outgoing coupling × spread')
        output.push('='.repeat(80))
        output.push('  score = outEdges × fanOut  (stable cores excluded — they are healthy)\n')

        for (const [i, entry] of priorityRanked.slice(0, 10).entries()) {
            const c = entry.community
            const shortId = c.id.replace(/^[^/]+\//, '')
            output.push('  ' + [
                String(i + 1).padStart(2) + '.',
                `${entry.parentId}/${shortId}`.padEnd(42),
                `score=${String(entry.score).padStart(4)}`,
                `outEdges=${String(c.outEdges).padStart(3)}`,
                `reaches=${String(c.fanOut).padStart(2)}`,
                `BW=${c.boundaryWidth.toFixed(2)}`,
            ].join('  '))
        }

        console.info(output.join('\n'))

        // Orange gate: fail when any community exceeds the priority budget.
        const {orangePriorityBudget: ORANGE_PRIORITY_BUDGET} = readBudgetSync<{orangePriorityBudget: number}>('complexity/hierarchical-complexity.json')

        const overBudget = priorityRanked.filter(p => p.score > ORANGE_PRIORITY_BUDGET)
        await recordHealthMetric({
            metricId: 'hierarchical-complexity',
            metricName: 'Hierarchical Complexity Orange Gate',
            description: 'Highest outgoing-coupling priority score across directory containment communities.',
            category: 'Complexity',
            current: priorityRanked.reduce((max, p) => Math.max(max, p.score), 0),
            budget: ORANGE_PRIORITY_BUDGET,
            comparison: 'lte',
            unit: 'score',
            details: {
                overBudget: overBudget.slice(0, 20),
                topPriority: priorityRanked.slice(0, 20),
                communityCount: allCommunities.length,
                maxDepth,
            },
        })
        if (overBudget.length > 0) {
            const lines: string[] = [
                '',
                `Orange complexity gate: ${overBudget.length} communities exceed priority budget (score > ${ORANGE_PRIORITY_BUDGET}).`,
                'Highest priority to improve (outgoing coupling × spread):',
            ]
            for (const [i, p] of overBudget.slice(0, 5).entries()) {
                const shortId = p.community.id.replace(/^[^/]+\//, '')
                lines.push(`  ${i + 1}. ${p.parentId}/${shortId}  score=${p.score}  outEdges=${p.community.outEdges}  reaches=${p.community.fanOut} siblings`)
            }
            lines.push('')
            lines.push('Lower ORANGE_PRIORITY_BUDGET as you address top offenders.')
            throw new Error(lines.join('\n'))
        }
    })
})
