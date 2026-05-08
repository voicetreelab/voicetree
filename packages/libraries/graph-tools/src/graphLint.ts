import { readFileSync, writeFileSync } from 'fs'
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
    DEFAULT_AUTHORING_COLOR,
    prepareAuthoringMarkdown,
    type AuthoringFix,
    type AuthoringRejection,
} from './authoringFixes'
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
    authoring?: GraphLintAuthoringReport
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

export type GraphLintAuthoringEntry = {
    readonly filename: string
    readonly fixes: readonly AuthoringFix[]
    readonly rejections: readonly AuthoringRejection[]
    readonly applied: boolean
}

export type GraphLintAuthoringReport = {
    readonly mode: 'check' | 'fix'
    readonly scannedFiles: number
    readonly changedFiles: number
    readonly rejectedFiles: number
    readonly entries: readonly GraphLintAuthoringEntry[]
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

    const folderIndexMap: Map<string, string> = buildFolderIndexMap(nodeIds)
    const containment: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, folderIndexMap)
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

    const orphanResults: LintResult[] = findOrphans(
        nodeIds,
        containment,
        allResolvedLinks,
        new Set(folderIndexMap.values())
    )
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

export function lintGraphWithFixes(params: {
    readonly folderPath: string
    readonly config?: LintConfig
    readonly applyFixes?: boolean
    readonly agentName?: string
    readonly defaultColor?: string
}): GraphLintReport {
    const normalizedRoot: string = path.resolve(params.folderPath)
    const mdFiles: readonly string[] = scanMarkdownFiles(params.folderPath)
    const entries: GraphLintAuthoringEntry[] = []
    let changedFiles: number = 0

    for (const filePath of mdFiles) {
        const originalMarkdown: string = readFileSync(filePath, 'utf-8')
        const relativeFilename: string = path.relative(normalizedRoot, filePath).replace(/\\/g, '/')
        const preparedMarkdown: {
            readonly markdown: string
            readonly fixes: readonly AuthoringFix[]
            readonly rejections: readonly AuthoringRejection[]
        } = prepareAuthoringMarkdown({
            filename: relativeFilename,
            markdown: originalMarkdown,
            agentName: params.agentName,
            defaultColor: params.defaultColor ?? DEFAULT_AUTHORING_COLOR,
        })

        if (preparedMarkdown.fixes.length === 0 && preparedMarkdown.rejections.length === 0) {
            continue
        }

        const shouldApplyFixes: boolean =
            Boolean(params.applyFixes) &&
            preparedMarkdown.rejections.length === 0 &&
            preparedMarkdown.markdown !== originalMarkdown

        if (shouldApplyFixes) {
            writeFileSync(filePath, preparedMarkdown.markdown, 'utf-8')
            changedFiles += 1
        }

        entries.push({
            filename: relativeFilename,
            fixes: preparedMarkdown.fixes,
            rejections: preparedMarkdown.rejections,
            applied: shouldApplyFixes,
        })
    }

    const report: GraphLintReport = lintGraph(params.folderPath, params.config ?? DEFAULT_LINT_CONFIG)
    return {
        ...report,
        authoring: {
            mode: params.applyFixes ? 'fix' : 'check',
            scannedFiles: mdFiles.length,
            changedFiles,
            rejectedFiles: entries.filter(entry => entry.rejections.length > 0).length,
            entries,
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

    if (report.authoring && report.authoring.entries.length > 0) {
        lines.push(`${report.authoring.mode === 'fix' ? 'AUTHORING FIXES' : 'AUTHORING CHECK'} (${report.authoring.entries.length}):`)
        for (const entry of report.authoring.entries) {
            if (entry.rejections.length > 0) {
                lines.push(`  ✗ ${entry.filename} REJECTED: ${entry.rejections[0]!.message}`)
                for (const suggestion of entry.rejections[0]!.suggestions) {
                    lines.push(`    → ${suggestion}`)
                }
                if (entry.fixes.length > 0) {
                    lines.push(`    ${entry.applied ? 'fixed' : 'would fix'}: ${entry.fixes.map(fix => fix.message).join('; ')}`)
                }
                continue
            }

            const statusLabel: string = entry.applied ? 'fixed' : 'would fix'
            const statusIcon: string = entry.applied ? '✓' : '~'
            lines.push(`  ${statusIcon} ${entry.filename} (${statusLabel}: ${entry.fixes.map(fix => fix.message).join('; ')})`)
        }
        lines.push('')
    }

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
