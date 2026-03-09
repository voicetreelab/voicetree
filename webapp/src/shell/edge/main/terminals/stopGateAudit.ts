/**
 * Stop Gate Audit — BF-024 enforcement
 *
 * Parses SKILL.md outgoing edges, checks agent compliance,
 * builds deficiency prompts for non-compliant agents.
 */

import * as fs from 'fs'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getNewNodesForAgent} from '@/shell/edge/main/mcp-server/getNewNodesForAgent'
import {getTerminalRecords, type TerminalRecord} from './terminal-registry'
import type {Graph} from '@/pure/graph'

type EdgeType = 'hard' | 'soft'
type OutgoingEdge = { path: string; type: EdgeType; workflowName: string }

export type AuditResult = {
    passed: boolean
    violations: Array<{ edge: OutgoingEdge; reason: string }>
    hasProgressNodes: boolean
}

/**
 * Parse ## Outgoing Workflows section from a SKILL.md file.
 * Hard edges: [[path]] — double brackets
 * Soft edges: [path] — single brackets (but not [[]])
 */
export function parseOutgoingEdges(skillContent: string): OutgoingEdge[] {
    const edges: OutgoingEdge[] = []
    const sectionMatch: RegExpMatchArray | null = skillContent.match(/## Outgoing Workflows\n([\s\S]*?)(?=\n## |\n---|$)/)
    if (!sectionMatch) return edges

    const section: string = sectionMatch[1]
    // Match hard edges: [[path]]
    const hardPattern: RegExp = /\[\[([^\]]+\/SKILL\.md)\]\]/g
    let match: RegExpExecArray | null
    while ((match = hardPattern.exec(section)) !== null) {
        const path: string = match[1]
        edges.push({ path, type: 'hard', workflowName: extractWorkflowName(path) })
    }
    // Match soft edges: [path] but NOT [[path]]
    const softPattern: RegExp = /(?<!\[)\[([^[\]]+\/SKILL\.md)\](?!\])/g
    while ((match = softPattern.exec(section)) !== null) {
        const path: string = match[1]
        edges.push({ path, type: 'soft', workflowName: extractWorkflowName(path) })
    }
    return edges
}

function extractWorkflowName(skillPath: string): string {
    // ~/brain/workflows/meta/promote/SKILL.md → "promote"
    const parts: string[] = skillPath.split('/')
    const skillIndex: number = parts.indexOf('SKILL.md')
    return skillIndex > 0 ? parts[skillIndex - 1] : skillPath
}

/**
 * Run the stop gate audit for an agent.
 * Checks: (1) progress nodes exist, (2) hard edges have spawned children, (3) soft edges mentioned in content.
 */
export function runStopGateAudit(terminalId: string, skillPath: string): AuditResult {
    let skillContent: string
    try {
        const resolvedPath: string = skillPath.replace('~/brain/', (process.env.HOME ?? '') + '/brain/')
        skillContent = fs.readFileSync(resolvedPath, 'utf-8')
    } catch {
        // No SKILL.md or unreadable — pass (no edges to enforce)
        return { passed: true, violations: [], hasProgressNodes: true }
    }

    const edges: OutgoingEdge[] = parseOutgoingEdges(skillContent)
    if (edges.length === 0) {
        return { passed: true, violations: [], hasProgressNodes: true }
    }

    const graph: Graph = getGraph()
    const record: TerminalRecord | undefined = getTerminalRecords().find(r => r.terminalId === terminalId)
    if (!record) return { passed: true, violations: [], hasProgressNodes: true }

    // Check progress nodes
    const agentNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(graph, record.terminalData.agentName)
    const hasProgressNodes: boolean = agentNodes.length > 0

    // Check each edge
    const violations: AuditResult['violations'] = []

    for (const edge of edges) {
        if (edge.type === 'hard') {
            // Hard edge: check if agent spawned a child for this workflow
            const spawnedChild: boolean = getTerminalRecords().some(
                r => r.terminalData.parentTerminalId === terminalId
            )
            if (!spawnedChild) {
                violations.push({ edge, reason: `Hard edge violation: did not spawn workflow "${edge.workflowName}"` })
            }
        } else {
            // Soft edge: check if workflow mentioned in any progress node content
            const mentioned: boolean = agentNodes.some(node => {
                const graphNode: import('@/pure/graph').GraphNode | undefined = graph.nodes[node.nodeId]
                if (!graphNode) return false
                const content: string = graphNode.contentWithoutYamlOrLinks.toLowerCase()
                return content.includes(edge.workflowName.toLowerCase())
            })
            if (!mentioned) {
                violations.push({ edge, reason: `Soft edge violation: did not reason about "${edge.workflowName}" in any progress node` })
            }
        }
    }

    if (!hasProgressNodes) {
        violations.push({
            edge: { path: '', type: 'hard', workflowName: 'progress-nodes' },
            reason: 'No progress nodes created — agent produced no visible work'
        })
    }

    return { passed: violations.length === 0, violations, hasProgressNodes }
}

/**
 * Build a deficiency prompt for a failed audit.
 */
export function buildDeficiencyPrompt(result: AuditResult): string {
    const lines: string[] = ['STOP GATE AUDIT FAILED. Address these before exiting:\n']
    for (const v of result.violations) {
        lines.push(`- ${v.reason}`)
    }
    lines.push('\nAddress each violation, then exit normally.')
    return lines.join('\n')
}

/**
 * Resolve which SKILL.md an agent is running from its task node.
 * Two resolution paths:
 * 1. Task node IS a SKILL.md — filepath ends with /SKILL.md
 * 2. Task node content references a SKILL.md — parse for ~/brain/.../SKILL.md paths
 */
export function resolveSkillPath(taskNodePath: string, taskNodeContent: string): string | null {
    // Case 1: task node itself is a SKILL.md
    if (taskNodePath.endsWith('/SKILL.md')) {
        // Convert absolute path to ~/brain/ form for consistency with edge parsing
        const brainDir: string = (process.env.HOME ?? '') + '/brain/'
        if (taskNodePath.includes(brainDir)) {
            return '~/brain/' + taskNodePath.split(brainDir)[1]
        }
        return taskNodePath
    }

    // Case 2: task node content references a specific SKILL.md (with subdirectory path)
    const specificMatch: RegExpMatchArray | null = taskNodeContent.match(/~\/brain\/[^\s\])}>]+\/SKILL\.md/)
    if (specificMatch) return specificMatch[0]

    // Case 3: task node content references the root ~/brain/SKILL.md
    const rootMatch: RegExpMatchArray | null = taskNodeContent.match(/~\/brain\/SKILL\.md/)
    if (rootMatch) return rootMatch[0]

    return null
}
