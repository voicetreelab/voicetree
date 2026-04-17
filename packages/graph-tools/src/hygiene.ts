import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { scanMarkdownFiles, extractLinks, getNodeId, buildUniqueBasenameMap, resolveLinkTarget, type StructureNode } from './primitives'
import { buildFolderIndexMap } from './lintContainment'
import { HYGIENE_THRESHOLDS, type HygieneThresholds } from './hygieneThresholds'

export type HygieneRuleId = 'max_wikilinks_per_node' | 'max_tree_width' | 'canonical_hierarchy'

export type HygieneViolation = {
    ruleId: HygieneRuleId
    severity: 'error' | 'warning'
    filePath: string
    message: string
    actual: number | string
    threshold: number | string
}

export type HygieneReport = {
    vaultPath: string
    violations: HygieneViolation[]
    summary: {
        totalNodes: number
        totalViolations: number
        totalErrors: number
        totalWarnings: number
    }
}

const PARENT_EDGE_REGEX = /^- parent \[\[([^\]]+)\]\]/m

function extractDeclaredParent(content: string): string | undefined {
    const match = content.match(PARENT_EDGE_REGEX)
    if (!match?.[1]) return undefined
    return match[1].split('|')[0]?.split('#')[0]?.trim() || undefined
}

function isCanonicalFolderNote(nodeId: string): boolean {
    const dir = path.posix.dirname(nodeId)
    return dir !== '.' && path.posix.basename(nodeId) === path.posix.basename(dir)
}

export function checkMaxWikilinksPerNode(
    nodes: ReadonlyArray<{nodeId: string; content: string}>,
    threshold: number,
): HygieneViolation[] {
    const violations: HygieneViolation[] = []
    for (const {nodeId, content} of nodes) {
        const count = extractLinks(content).length
        if (count > threshold) {
            violations.push({
                ruleId: 'max_wikilinks_per_node',
                severity: 'error',
                filePath: nodeId,
                message: `${count} outgoing wikilinks (threshold: ${threshold})`,
                actual: count,
                threshold,
            })
        }
    }
    return violations
}

export function checkMaxTreeWidth(
    vaultPath: string,
    threshold: number,
): HygieneViolation[] {
    const violations: HygieneViolation[] = []
    const resolved = path.resolve(vaultPath)

    function walk(dir: string): void {
        let entries: string[]
        try {
            entries = readdirSync(dir)
        } catch {
            return
        }
        const children = entries.filter(e => !e.startsWith('.') && e !== 'ctx-nodes')
        const childCount = children.filter(e => {
            try { return true } catch { return false }
        }).length

        // Count actual children that exist
        let actualCount = 0
        for (const entry of children) {
            const full = path.join(dir, entry)
            try {
                statSync(full)
                actualCount++
            } catch {
                // skip
            }
        }

        if (actualCount > threshold) {
            const relDir = path.relative(resolved, dir) || '.'
            violations.push({
                ruleId: 'max_tree_width',
                severity: 'error',
                filePath: relDir,
                message: `${actualCount} immediate children in ${relDir}/ (threshold: ${threshold})`,
                actual: actualCount,
                threshold,
            })
        }

        for (const entry of children) {
            const full = path.join(dir, entry)
            try {
                if (statSync(full).isDirectory()) walk(full)
            } catch {
                // skip
            }
        }
    }

    walk(resolved)
    return violations
}

export function checkCanonicalHierarchy(
    nodes: ReadonlyArray<{nodeId: string; content: string}>,
    folderIndexMap: ReadonlyMap<string, string>,
    nodesById: ReadonlyMap<string, StructureNode>,
    uniqueBasenames: ReadonlyMap<string, string>,
): HygieneViolation[] {
    const violations: HygieneViolation[] = []

    const folderNoteIds = new Set(folderIndexMap.values())

    for (const {nodeId, content} of nodes) {
        const dir = path.posix.dirname(nodeId)

        // Check declared parent edges for conflicts
        const rawParent = extractDeclaredParent(content)
        if (rawParent) {
            const resolvedParent = resolveLinkTarget(rawParent, nodeId, nodesById, uniqueBasenames)
            if (resolvedParent !== undefined) {
                const canonicalParent = dir !== '.' ? folderIndexMap.get(dir) : undefined
                if (canonicalParent !== undefined && resolvedParent !== canonicalParent) {
                    // Declared parent conflicts with filesystem containment
                    violations.push({
                        ruleId: 'canonical_hierarchy',
                        severity: 'error',
                        filePath: nodeId,
                        message: `parent [[${rawParent}]] conflicts with filesystem parent (${canonicalParent})`,
                        actual: resolvedParent,
                        threshold: canonicalParent,
                    })
                }
            }
        }

        // Check non-parent wikilinks to folder-notes outside the node's subtree
        const links = extractLinks(content)
        const parentEdgeRaw = rawParent ? `[[${rawParent}` : null
        for (const link of links) {
            // Skip the parent edge link itself
            if (parentEdgeRaw && link.startsWith(rawParent ?? '')) continue

            const resolved = resolveLinkTarget(link, nodeId, nodesById, uniqueBasenames)
            if (resolved === undefined) continue
            if (!folderNoteIds.has(resolved)) continue
            if (isCanonicalFolderNote(resolved)) {
                // It's a folder-note — check if it's in the node's ancestor chain
                const resolvedDir = path.posix.dirname(resolved)
                if (!dir.startsWith(resolvedDir) && resolvedDir !== dir) {
                    violations.push({
                        ruleId: 'canonical_hierarchy',
                        severity: 'warning',
                        filePath: nodeId,
                        message: `wikilink to folder-note [[${link}]] in unrelated subtree`,
                        actual: resolved,
                        threshold: 'ancestor-or-self',
                    })
                }
            }
        }
    }

    return violations
}

export function runHygieneAudit(
    vaultPath: string,
    options: {
        rule?: HygieneRuleId
        thresholds?: Partial<HygieneThresholds>
    } = {},
): HygieneReport {
    const resolved = path.resolve(vaultPath)
    const thresholds = {...HYGIENE_THRESHOLDS, ...options.thresholds}
    const mdFiles = scanMarkdownFiles(resolved)

    const nodes = mdFiles.map(filePath => ({
        nodeId: getNodeId(resolved, filePath),
        content: readFileSync(filePath, 'utf-8'),
    }))

    const nodeIds = nodes.map(n => n.nodeId)
    const nodesById: Map<string, StructureNode> = new Map(
        nodes.map(({nodeId}) => [nodeId, {id: nodeId, title: '', outgoingIds: []}])
    )
    const uniqueBasenames = buildUniqueBasenameMap(nodesById)
    const folderIndexMap = buildFolderIndexMap(nodeIds)

    const rule = options.rule
    const allViolations: HygieneViolation[] = []

    if (!rule || rule === 'max_wikilinks_per_node') {
        allViolations.push(...checkMaxWikilinksPerNode(nodes, thresholds.maxWikilinksPerNode))
    }
    if (!rule || rule === 'max_tree_width') {
        allViolations.push(...checkMaxTreeWidth(resolved, thresholds.maxTreeWidth))
    }
    if (!rule || rule === 'canonical_hierarchy') {
        allViolations.push(...checkCanonicalHierarchy(nodes, folderIndexMap, nodesById, uniqueBasenames))
    }

    const errors = allViolations.filter(v => v.severity === 'error').length
    const warnings = allViolations.filter(v => v.severity === 'warning').length

    return {
        vaultPath: resolved,
        violations: allViolations,
        summary: {
            totalNodes: nodes.length,
            totalViolations: allViolations.length,
            totalErrors: errors,
            totalWarnings: warnings,
        },
    }
}

export function formatHygieneReportHuman(report: HygieneReport): string {
    const lines: string[] = []

    // Group violations by file
    const byFile = new Map<string, HygieneViolation[]>()
    for (const v of report.violations) {
        const list = byFile.get(v.filePath) ?? []
        list.push(v)
        byFile.set(v.filePath, list)
    }

    for (const [filePath, violations] of byFile) {
        lines.push(filePath)
        for (const v of violations) {
            const icon = v.severity === 'error' ? '  error' : '  warning'
            lines.push(`${icon}  ${v.ruleId}: ${v.message}`)
        }
        lines.push('')
    }

    const {totalViolations, totalErrors, totalWarnings, totalNodes} = report.summary
    if (totalViolations === 0) {
        lines.push(`✓ No violations (${totalNodes} nodes)`)
    } else {
        lines.push(`${totalViolations} violation${totalViolations !== 1 ? 's' : ''} (${totalErrors} error${totalErrors !== 1 ? 's' : ''}, ${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}) across ${byFile.size} file${byFile.size !== 1 ? 's' : ''}`)
    }

    return lines.join('\n')
}

export function formatHygieneReportJson(report: HygieneReport): string {
    return JSON.stringify(report, null, 2)
}
