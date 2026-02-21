/**
 * Validation system for create_graph MCP tool.
 * Pure functions and types only — no side effects.
 *
 * Implements overridable "soft rules" that agents can bypass by providing
 * an override_with_rationale entry matching the rule ID. Hard validations
 * (missing fields, cycles, etc.) remain in createGraphTool.ts and are never overridable.
 */

import type {CreateGraphNodeInput} from './createGraphTool'
import type {Graph, NodeIdAndFilePath} from '@/pure/graph'
import {countBodyLines} from './addProgressNodeTool'

// ============================================================================
// Types
// ============================================================================

export type ValidationRuleId = 'grandparent_attachment' | 'node_line_limit'

export interface RuleViolation {
    readonly ruleId: ValidationRuleId
    readonly message: string
    readonly nodeFilename: string // '__graph_root__' for graph-level rules
    readonly details: Record<string, unknown>
}

export interface OverrideEntry {
    readonly ruleId: ValidationRuleId
    readonly rationale: string
}

export type ValidationResult =
    | { readonly status: 'pass' }
    | { readonly status: 'violations'; readonly violations: readonly RuleViolation[] }

export interface ValidationRule {
    readonly id: ValidationRuleId
    readonly description: string
    readonly check: (ctx: ValidationContext) => readonly RuleViolation[]
}

export interface ValidationContext {
    readonly nodes: readonly CreateGraphNodeInput[]
    readonly resolvedParentNodeId: NodeIdAndFilePath
    readonly callerTaskNodeId: NodeIdAndFilePath | null
    readonly graph: Graph
    readonly lineLimit: number
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Run all validation rules against the context, collecting violations.
 * Returns 'pass' if no violations, otherwise returns all violations.
 */
export function runValidations(
    rules: readonly ValidationRule[],
    ctx: ValidationContext,
): ValidationResult {
    const violations: RuleViolation[] = []
    for (const rule of rules) {
        const ruleViolations: readonly RuleViolation[] = rule.check(ctx)
        violations.push(...ruleViolations)
    }
    return violations.length === 0
        ? { status: 'pass' }
        : { status: 'violations', violations }
}

/**
 * Match violations against override entries by ruleId.
 * Returns unresolved violations (no matching override) and accepted overrides.
 */
export function resolveOverrides(
    violations: readonly RuleViolation[],
    overrides: readonly OverrideEntry[],
): {
    readonly unresolved: readonly RuleViolation[]
    readonly accepted: readonly OverrideEntry[]
} {
    const overridesByRuleId: Map<ValidationRuleId, OverrideEntry> = new Map()
    for (const entry of overrides) {
        overridesByRuleId.set(entry.ruleId, entry)
    }

    const unresolved: RuleViolation[] = []
    const accepted: OverrideEntry[] = []
    const usedRuleIds: Set<ValidationRuleId> = new Set()

    for (const violation of violations) {
        const override: OverrideEntry | undefined = overridesByRuleId.get(violation.ruleId)
        if (override) {
            if (!usedRuleIds.has(violation.ruleId)) {
                accepted.push(override)
                usedRuleIds.add(violation.ruleId)
            }
        } else {
            unresolved.push(violation)
        }
    }

    return { unresolved, accepted }
}

/**
 * Build a human-readable error string from unresolved violations,
 * including rule IDs, messages, and a JSON example of how to override.
 */
export function formatViolationError(unresolved: readonly RuleViolation[]): string {
    const lines: string[] = [
        'Validation failed. The following rules were violated:',
        '',
    ]

    for (const v of unresolved) {
        lines.push(`  • [${v.ruleId}] ${v.message} (node: "${v.nodeFilename}")`)
    }

    const uniqueRuleIds: ValidationRuleId[] = [...new Set(unresolved.map((v: RuleViolation) => v.ruleId))]
    const exampleOverrides: readonly { ruleId: ValidationRuleId; rationale: string }[] =
        uniqueRuleIds.map((ruleId: ValidationRuleId) => ({
            ruleId,
            rationale: '<explain why this override is justified>',
        }))

    lines.push('')
    lines.push('To override, add "override_with_rationale" to your create_graph call:')
    lines.push(JSON.stringify(exampleOverrides, null, 2))

    return lines.join('\n')
}

// ============================================================================
// Rules
// ============================================================================

const MAX_ANCESTOR_DEPTH: number = 20

/**
 * Grandparent attachment rule: agents should attach nodes to their own task node
 * or descendants of it, not to ancestors of the task node.
 *
 * BFS upward from callerTaskNodeId via incomingEdgesIndex. If resolvedParentNodeId
 * is found among ancestors, the agent is attaching above its task — violation.
 *
 * Skips when:
 * - callerTaskNodeId is null (user terminal, no task scope to check)
 * - resolvedParentNodeId IS the callerTaskNodeId (attaching to own task is fine)
 */
const grandparentAttachmentRule: ValidationRule = {
    id: 'grandparent_attachment',
    description: 'Agents must attach nodes to their task node or its descendants, not to ancestors of the task node.',
    check(ctx: ValidationContext): readonly RuleViolation[] {
        // Skip: user terminal (no task node)
        if (ctx.callerTaskNodeId === null) return []
        // Skip: attaching directly to own task node
        if (ctx.resolvedParentNodeId === ctx.callerTaskNodeId) return []

        // BFS upward from task node to collect ancestors
        const ancestors: Set<NodeIdAndFilePath> = new Set()
        const queue: NodeIdAndFilePath[] = [ctx.callerTaskNodeId]
        let depth: number = 0

        while (queue.length > 0 && depth < MAX_ANCESTOR_DEPTH) {
            const levelSize: number = queue.length
            for (let i: number = 0; i < levelSize; i++) {
                const current: NodeIdAndFilePath = queue[i]
                const parents: readonly NodeIdAndFilePath[] | undefined =
                    ctx.graph.incomingEdgesIndex.get(current)
                if (parents) {
                    for (const parent of parents) {
                        if (!ancestors.has(parent)) {
                            ancestors.add(parent)
                            queue.push(parent)
                        }
                    }
                }
            }
            // Remove processed nodes from front of queue
            queue.splice(0, levelSize)
            depth++
        }

        if (ancestors.has(ctx.resolvedParentNodeId)) {
            return [{
                ruleId: 'grandparent_attachment',
                message: `Target parent "${ctx.resolvedParentNodeId}" is an ancestor of your task node "${ctx.callerTaskNodeId}". Attach to your task node or its descendants instead.`,
                nodeFilename: '__graph_root__',
                details: {
                    resolvedParentNodeId: ctx.resolvedParentNodeId,
                    callerTaskNodeId: ctx.callerTaskNodeId,
                },
            }]
        }

        return []
    },
}

/**
 * Node line limit rule: each node's body (summary + content) must not exceed
 * the configured line limit. Encourages splitting large nodes into trees.
 */
const nodeLineLimitRule: ValidationRule = {
    id: 'node_line_limit',
    description: 'Each node body (summary + content) must not exceed the configured line limit.',
    check(ctx: ValidationContext): readonly RuleViolation[] {
        const violations: RuleViolation[] = []
        for (const node of ctx.nodes) {
            const bodyLines: number = countBodyLines(node.summary, node.content)
            if (bodyLines > ctx.lineLimit) {
                violations.push({
                    ruleId: 'node_line_limit',
                    message: `Node is too long (${bodyLines} lines, limit is ${ctx.lineLimit}). Split into a tree of nodes using the \`parents\` field.`,
                    nodeFilename: node.filename,
                    details: {
                        bodyLines,
                        lineLimit: ctx.lineLimit,
                    },
                })
            }
        }
        return violations
    },
}

// ============================================================================
// Export
// ============================================================================

export const ALL_RULES: readonly ValidationRule[] = [grandparentAttachmentRule, nodeLineLimitRule]
