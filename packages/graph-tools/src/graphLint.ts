import { readFileSync } from 'fs'
import path from 'path'
import {
    scanMarkdownFiles,
    extractLinks,
    getNodeId,
    resolveLinkTarget,
    buildUniqueBasenameMap,
    type StructureNode,
} from './primitives'
import { buildFolderIndexMap, buildContainmentTree, type ContainmentTree } from './lintContainment'
import {
    classifyEdges,
    computeNodeMetrics,
    checkRules,
    findDuplicateEdges,
    findOrphans,
    DEFAULT_LINT_CONFIG,
    type NodeMetrics,
    type LintResult,
    type LintConfig,
} from './lintRules'

// Re-export for consumers of this module
export type { ContainmentTree } from './lintContainment'
export { buildContainmentTree, buildFolderIndexMap } from './lintContainment'
export type { ClassifiedEdge, NodeMetrics, LintResult, LintConfig } from './lintRules'
export { classifyEdges, computeNodeMetrics, checkRules, DEFAULT_LINT_CONFIG } from './lintRules'

export type GraphLintReport = {
    nodeMetrics: Map<string, NodeMetrics>
    violations: LintResult[]
    warnings: LintResult[]
    summary: {
        totalNodes: number
        maxDepth: number
        meanBranchingFactor: number
        maxAttentionItems: number
        orphanCount: number
        violationCount: number
        warningCount: number
    }
}

export function lintGraph(folderPath: string, config: LintConfig = DEFAULT_LINT_CONFIG): GraphLintReport {
    const mdFiles: readonly string[] = scanMarkdownFiles(folderPath)
    const normalizedRoot: string = path.resolve(folderPath)

    if (mdFiles.length === 0) {
        return {
            nodeMetrics: new Map(),
            violations: [],
            warnings: [],
            summary: { totalNodes: 0, maxDepth: 0, meanBranchingFactor: 0, maxAttentionItems: 0, orphanCount: 0, violationCount: 0, warningCount: 0 },
        }
    }

    const fileRecords: readonly { absolutePath: string; content: string }[] = mdFiles.map(filePath => ({
        absolutePath: filePath,
        content: readFileSync(filePath, 'utf-8'),
    }))

    const nodeIds: string[] = fileRecords.map(f => getNodeId(normalizedRoot, f.absolutePath))
    const nodeContents: Map<string, string> = new Map(
        fileRecords.map(f => [getNodeId(normalizedRoot, f.absolutePath), f.content])
    )

    const nodesById: Map<string, StructureNode> = new Map(
        fileRecords.map(({ absolutePath }) => {
            const id: string = getNodeId(normalizedRoot, absolutePath)
            return [id, { id, title: '', outgoingIds: [] }]
        })
    )
    const uniqueBasenames: Map<string, string> = buildUniqueBasenameMap(nodesById)

    const allResolvedLinks: Map<string, string[]> = new Map()
    const allRawLinks: Map<string, string[]> = new Map()
    for (const { absolutePath, content } of fileRecords) {
        const nodeId: string = getNodeId(normalizedRoot, absolutePath)
        const rawLinks: string[] = extractLinks(content)
        allRawLinks.set(nodeId, rawLinks)
        const resolved: string[] = rawLinks
            .map(link => resolveLinkTarget(link, nodeId, nodesById, uniqueBasenames))
            .filter((id): id is string => id !== undefined)
        allResolvedLinks.set(nodeId, resolved)
    }

    const containment: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, buildFolderIndexMap(nodeIds))
    const edges = classifyEdges(allResolvedLinks, containment)

    const nodeMetrics: Map<string, NodeMetrics> = new Map()
    for (const nodeId of nodeIds) {
        nodeMetrics.set(nodeId, computeNodeMetrics(nodeId, containment, edges, config))
    }

    const violations: LintResult[] = []
    const warnings: LintResult[] = []

    for (const nodeId of nodeIds) {
        const metrics: NodeMetrics = nodeMetrics.get(nodeId)!
        for (const result of checkRules(nodeId, metrics, config, nodeIds.length)) {
            if (result.severity === 'violation') violations.push(result)
            else warnings.push(result)
        }
        violations.push(...findDuplicateEdges(nodeId, allRawLinks.get(nodeId) ?? [], allResolvedLinks.get(nodeId) ?? []))
    }

    const orphanResults: LintResult[] = findOrphans(nodeIds, containment, allResolvedLinks)
    warnings.push(...orphanResults)

    const metricsValues: NodeMetrics[] = [...nodeMetrics.values()]
    const nonLeafNodes: NodeMetrics[] = metricsValues.filter(m => m.nChildren > 0)

    return {
        nodeMetrics,
        violations,
        warnings,
        summary: {
            totalNodes: nodeIds.length,
            maxDepth: Math.max(0, ...metricsValues.map(m => m.depth)),
            meanBranchingFactor: nonLeafNodes.length > 0
                ? nonLeafNodes.reduce((sum, m) => sum + m.nChildren, 0) / nonLeafNodes.length
                : 0,
            maxAttentionItems: Math.max(0, ...metricsValues.map(m => m.attentionItems)),
            orphanCount: orphanResults.length,
            violationCount: violations.length,
            warningCount: warnings.length,
        },
    }
}

export function formatLintReportHuman(report: GraphLintReport): string {
    const lines: string[] = []
    lines.push(`Graph Lint Report: ${report.summary.totalNodes} nodes`)
    lines.push(`  Max depth: ${report.summary.maxDepth}`)
    lines.push(`  Mean branching factor: ${report.summary.meanBranchingFactor.toFixed(1)}`)
    lines.push(`  Max attention items: ${report.summary.maxAttentionItems}`)
    lines.push(`  Orphans: ${report.summary.orphanCount}`)
    lines.push('')

    if (report.violations.length > 0) {
        lines.push(`VIOLATIONS (${report.violations.length}):`)
        for (const v of report.violations) {
            lines.push(`  ✗ ${v.ruleId} at ${v.nodeId}: ${v.value} (threshold: ${v.threshold})`)
            lines.push(`    → ${v.suggestion}`)
        }
        lines.push('')
    }

    if (report.warnings.length > 0) {
        lines.push(`WARNINGS (${report.warnings.length}):`)
        for (const w of report.warnings) {
            lines.push(`  ⚠ ${w.ruleId} at ${w.nodeId}: ${w.value} (threshold: ${w.threshold})`)
            lines.push(`    → ${w.suggestion}`)
        }
        lines.push('')
    }

    if (report.violations.length === 0 && report.warnings.length === 0) {
        lines.push('No issues found.')
    }

    return lines.join('\n')
}

export function formatLintReportJson(report: GraphLintReport): string {
    const serializable = { ...report, nodeMetrics: Object.fromEntries(report.nodeMetrics) }
    return JSON.stringify(serializable, null, 2)
}
