/**
 * Stop Gate Audit — BF-024 enforcement, redesigned in BF-042
 *
 * Public API:
 * - auditAgent(terminalId, graph, records) → ComplianceResult | null
 * - buildDeficiencyPrompt(result) → string
 *
 * Internal pipeline (pure except SKILL.md file read):
 * deriveSkillPaths → parseObligations → collectEvidence → checkCompliance
 */

import * as fs from 'fs'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode} from '@/pure/graph'
import {getNodesByAgentName} from '@/pure/graph'
import type {TerminalRecord} from './terminal-registry'

// ─── Types (pipeline seams — not stored on any record) ──────────────────────

export type Obligation = {
    type: 'hard' | 'soft'
    workflowPath: string
    workflowName: string
}

type WorkEvidence = {
    progressNodes: readonly GraphNode[]
    childSkillPaths: readonly string[]
}

export type ComplianceResult = {
    passed: boolean
    violations: readonly Violation[]
}

export type Violation = {
    obligation: Obligation
    reason: string
}

// ─── Internal pipeline ─────────────────────────────────────────────────────

/**
 * Resolve ALL SKILL.md paths from task node path + content.
 * Two resolution paths:
 * 1. Task node IS a SKILL.md — filepath ends with /SKILL.md
 * 2. Task node content references SKILL.md paths — parse for ALL ~/brain/.../SKILL.md paths
 *
 * Exported for testing only — callers should use auditAgent.
 */
export function resolveSkillPathsFromContent(taskNodePath: string, taskNodeContent: string): string[] {
    // Case 1: task node itself is a SKILL.md
    if (/\/SKILL\.md$/i.test(taskNodePath)) {
        const brainDir: string = (process.env.HOME ?? '') + '/brain/'
        if (taskNodePath.includes(brainDir)) {
            return ['~/brain/' + taskNodePath.split(brainDir)[1]]
        }
        return [taskNodePath]
    }

    // Case 2: task node content references SKILL.md paths — find ALL matches, deduplicated
    const results: string[] = []
    const seen: Set<string> = new Set()
    const pattern: RegExp = /(?:~|\/)[^\s\])}>]*\/SKILL\.md/gi
    let match: RegExpExecArray | null
    while ((match = pattern.exec(taskNodeContent)) !== null) {
        const path: string = match[0]
        if (!seen.has(path)) {
            seen.add(path)
            results.push(path)
        }
    }
    return results
}

/**
 * Derive all SKILL.md paths an agent is running from graph + registry.
 * record → anchoredToNodeId (task node) → graph node → resolveSkillPathsFromContent
 */
function deriveSkillPaths(terminalId: string, graph: Graph, records: readonly TerminalRecord[]): string[] {
    const record: TerminalRecord | undefined = records.find(r => r.terminalId === terminalId)
    if (!record) return []

    const anchoredOpt: O.Option<string> = record.terminalData.anchoredToNodeId
    if (!O.isSome(anchoredOpt)) return []

    const taskNodeId: string = anchoredOpt.value
    const taskNode: GraphNode | undefined = graph.nodes[taskNodeId]
    if (!taskNode) return []

    return resolveSkillPathsFromContent(taskNode.absoluteFilePathIsID, taskNode.contentWithoutYamlOrLinks)
}

/**
 * Parse ## Outgoing Workflows section from SKILL.md content.
 * Hard edges: [[path]] — double brackets
 * Soft edges: [path] — single brackets (but not [[]])
 *
 * Exported for testing only — callers should use auditAgent.
 */
export function parseObligations(skillContent: string): Obligation[] {
    const obligations: Obligation[] = []
    const sectionMatch: RegExpMatchArray | null = skillContent.match(/## Outgoing Workflows\n([\s\S]*?)(?=\n## |\n---|$)/)
    if (!sectionMatch) return obligations

    const section: string = sectionMatch[1]

    // Hard edges: [[path]]
    const hardPattern: RegExp = /\[\[([^\]]+\/SKILL\.md)\]\]/g
    let match: RegExpExecArray | null
    while ((match = hardPattern.exec(section)) !== null) {
        const path: string = match[1]
        obligations.push({ type: 'hard', workflowPath: path, workflowName: extractWorkflowName(path) })
    }

    // Soft edges: [path] but NOT [[path]]
    const softPattern: RegExp = /(?<!\[)\[([^[\]]+\/SKILL\.md)\](?!\])/g
    while ((match = softPattern.exec(section)) !== null) {
        const path: string = match[1]
        obligations.push({ type: 'soft', workflowPath: path, workflowName: extractWorkflowName(path) })
    }

    return obligations
}

function extractWorkflowName(skillPath: string): string {
    const parts: string[] = skillPath.split('/')
    const skillIndex: number = parts.indexOf('SKILL.md')
    return skillIndex > 0 ? parts[skillIndex - 1] : skillPath
}

/**
 * Collect evidence of agent work: progress nodes + children's derived skill paths.
 */
function collectEvidence(terminalId: string, graph: Graph, records: readonly TerminalRecord[]): WorkEvidence {
    const record: TerminalRecord | undefined = records.find(r => r.terminalId === terminalId)
    if (!record) return { progressNodes: [], childSkillPaths: [] }

    // Progress nodes: nodes created by this agent (via agent_name YAML matching)
    const progressNodes: readonly GraphNode[] = getNodesByAgentName(graph, record.terminalData.agentName)

    // Child skill paths: derive each child agent's skill paths from their task nodes
    const children: readonly TerminalRecord[] = records.filter(r => r.terminalData.parentTerminalId === terminalId)
    const childSkillPaths: string[] = children
        .flatMap(child => deriveSkillPaths(child.terminalId, graph, records))

    return { progressNodes, childSkillPaths }
}

/**
 * Check obligations against evidence. Pure function.
 */
function checkCompliance(obligations: readonly Obligation[], evidence: WorkEvidence): ComplianceResult {
    const violations: Violation[] = []

    for (const obligation of obligations) {
        if (obligation.type === 'hard') {
            // Hard: check if a child is running this specific workflow
            const satisfied: boolean = evidence.childSkillPaths.some(
                childPath => childPath === obligation.workflowPath
            )
            if (!satisfied) {
                violations.push({
                    obligation,
                    reason: `Hard edge violation: did not spawn workflow "${obligation.workflowName}"`
                })
            }
        } else {
            // Soft: check if workflow mentioned in any progress node content
            const mentioned: boolean = evidence.progressNodes.some(node => {
                const content: string = node.contentWithoutYamlOrLinks.toLowerCase()
                return content.includes(obligation.workflowName.toLowerCase())
            })
            if (!mentioned) {
                violations.push({
                    obligation,
                    reason: `Soft edge violation: did not reason about "${obligation.workflowName}" in any progress node`
                })
            }
        }
    }

    // Check progress nodes exist
    if (evidence.progressNodes.length === 0) {
        violations.push({
            obligation: { type: 'hard', workflowPath: '', workflowName: 'progress-nodes' },
            reason: 'No progress nodes created — agent produced no visible work'
        })
    }

    return { passed: violations.length === 0, violations }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run the stop gate audit for an agent.
 * Derives everything at audit time from graph + registry — no stored skill binding.
 * Returns null if the agent has no associated SKILL.md (nothing to audit).
 */
export function auditAgent(terminalId: string, graph: Graph, records: readonly TerminalRecord[]): ComplianceResult | null {
    const skillPaths: string[] = deriveSkillPaths(terminalId, graph, records)

    // No explicit SKILL.md — virtual root with soft edge to ~/brain/SKILL.md
    if (skillPaths.length === 0) {
        const brainSkillPath: string = '~/brain/SKILL.md'
        const resolved: string = (process.env.HOME ?? '') + '/brain/SKILL.md'
        try { fs.accessSync(resolved) } catch { return null }

        const rootObligations: Obligation[] = [
            { type: 'soft', workflowPath: brainSkillPath, workflowName: 'brain' }
        ]
        const evidence: WorkEvidence = collectEvidence(terminalId, graph, records)
        return checkCompliance(rootObligations, evidence)
    }

    // Aggregate obligations from ALL skill paths
    const allObligations: Obligation[] = []
    for (const skillPath of skillPaths) {
        let skillContent: string
        try {
            const resolvedPath: string = skillPath.replace(/^~\/brain\//, (process.env.HOME ?? '') + '/brain/')
            skillContent = fs.readFileSync(resolvedPath, 'utf-8')
        } catch {
            continue // unreadable SKILL.md — skip this one
        }

        const obligations: Obligation[] = parseObligations(skillContent)
        // Always add a soft obligation for each SKILL.md itself — agent must reason about it
        const selfName: string = extractWorkflowName(skillPath)
        obligations.push({ type: 'soft', workflowPath: skillPath, workflowName: selfName })
        allObligations.push(...obligations)
    }

    if (allObligations.length === 0) return null

    const evidence: WorkEvidence = collectEvidence(terminalId, graph, records)
    return checkCompliance(allObligations, evidence)
}

/**
 * Build a deficiency prompt for a failed audit.
 */
export function buildDeficiencyPrompt(result: ComplianceResult): string {
    const lines: string[] = ['STOP GATE AUDIT FAILED. Address these before exiting:\n']
    for (const v of result.violations) {
        lines.push(`- ${v.reason}`)
    }
    lines.push('\nAddress each violation, then exit normally.')
    return lines.join('\n')
}
