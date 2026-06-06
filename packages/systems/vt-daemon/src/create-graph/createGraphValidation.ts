/**
 * Validation system for create_graph RPC tool.
 * Pure functions and types only — no side effects.
 *
 * Implements overridable "soft rules" that agents can bypass by providing
 * an override_with_rationale entry matching the rule ID. Hard validations
 * (missing fields, cycles, etc.) remain in createGraphTool.ts and are never overridable.
 */

import type {CreateGraphNodeInput} from './createGraphTypes'
import type {Graph, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {isFolderIdentityNote} from '@vt/graph-model/graph'
import {extractParentRefs, normalizeBatchFilenameKey, findBestMatchingNode, type ParentLineRef} from '@vt/graph-model/markdown'
import {computeGraphComplexity, type EdgePair, type GraphComplexityResult} from '@vt/graph-tools/node-runtime'
import {countBodyLines} from '../tools/graph/addProgressNodeTool'
import {countFolderBoundedComponent, collectFolderBoundedComponent} from './subgraphComponent'
import * as daemonProtocol from '@vt/vt-daemon-protocol'
import {
    type OverridableRuleId,
    type OverrideEntry,
} from '@vt/graph-validation'

// ============================================================================
// Types
// ============================================================================

/**
 * `severity` splits the two tiers, mirroring the linter's `LintResult.severity`:
 * - `'violation'` blocks the create (overridable via `override_with_rationale`).
 * - `'warning'` never blocks; it is surfaced in the create_graph success response
 *   and is not subject to override.
 */
export interface RuleViolation {
    readonly ruleId: OverridableRuleId
    readonly message: string
    readonly nodeFilename: string // '__graph_root__' for graph-level rules
    readonly severity: 'violation' | 'warning'
    readonly details: Record<string, unknown>
}

export type ValidationResult =
    | { readonly status: 'pass' }
    | { readonly status: 'violations'; readonly violations: readonly RuleViolation[] }

export interface ValidationRule {
    readonly id: OverridableRuleId
    readonly description: string
    readonly check: (ctx: ValidationContext) => readonly RuleViolation[]
}

export interface ValidationContext {
    readonly nodes: readonly CreateGraphNodeInput[]
    readonly resolvedParentNodeId: NodeIdAndFilePath
    readonly callerTaskNodeId: NodeIdAndFilePath | null
    readonly graph: Graph
    readonly lineLimit: number
    readonly subgraphWarnThreshold: number
    readonly subgraphErrorThreshold: number
    /** Max children a single node may have before child_count_limit blocks. */
    readonly maxChildrenPerNode: number
    /** Destination-component complexity score that triggers a non-blocking warning. */
    readonly complexityWarnScore: number
    /** Destination-component complexity score that blocks (overridable). */
    readonly complexityBlockScore: number
    /**
     * The folder (id with trailing slash) the batch's nodes will land in — the
     * component the subgraph_size_limit rule gardens. See design.md Decision 1a.
     */
    readonly destinationFolderPath: string
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
 * Split rule results by severity. Only `'violation'` results block (and are then
 * subject to override); `'warning'` results are surfaced non-blockingly. Pure.
 */
export function partitionViolationsBySeverity(violations: readonly RuleViolation[]): {
    readonly warnings: readonly RuleViolation[]
    readonly blocking: readonly RuleViolation[]
} {
    return {
        warnings: violations.filter((v: RuleViolation) => v.severity === 'warning'),
        blocking: violations.filter((v: RuleViolation) => v.severity === 'violation'),
    }
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
    const overridesByRuleId: Map<OverridableRuleId, OverrideEntry> = new Map()
    for (const entry of overrides) {
        overridesByRuleId.set(entry.ruleId, entry)
    }

    const unresolved: RuleViolation[] = []
    const accepted: OverrideEntry[] = []
    const usedRuleIds: Set<OverridableRuleId> = new Set()

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

    const uniqueRuleIds: OverridableRuleId[] = [...new Set(unresolved.map((v: RuleViolation) => v.ruleId))]
    const hintableRuleIds: OverridableRuleId[] = uniqueRuleIds.filter(
        (ruleId: OverridableRuleId) => ruleId !== daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId,
    )
    const exampleOverrides: readonly { ruleId: OverridableRuleId; rationale: string }[] =
        hintableRuleIds.map((ruleId: OverridableRuleId) => ({
            ruleId,
            rationale: '<explain why this override is justified>',
        }))

    lines.push('')
    if (uniqueRuleIds.includes(daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId)) {
        lines.push(daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.formatGuidance())
    }
    if (exampleOverrides.length > 0) {
        lines.push('To override the other violated rule(s), add "override_with_rationale" to your create_graph call:')
        lines.push(JSON.stringify(exampleOverrides, null, 2))
    }

    return lines.join('\n')
}

// ============================================================================
// Rules
// ============================================================================

const MAX_ANCESTOR_DEPTH: number = 20

function collectAncestorNodeIds(
    graph: Graph,
    callerTaskNodeId: NodeIdAndFilePath,
): ReadonlySet<NodeIdAndFilePath> {
    const ancestors: Set<NodeIdAndFilePath> = new Set()
    const queue: NodeIdAndFilePath[] = [callerTaskNodeId]
    let depth: number = 0

    while (queue.length > 0 && depth < MAX_ANCESTOR_DEPTH) {
        const levelSize: number = queue.length
        for (let i: number = 0; i < levelSize; i++) {
            const current: NodeIdAndFilePath = queue[i]
            const parents: readonly NodeIdAndFilePath[] | undefined =
                graph.incomingEdgesIndex.get(current)
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

    return ancestors
}

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
        const ancestors: ReadonlySet<NodeIdAndFilePath> =
            collectAncestorNodeIds(ctx.graph, ctx.callerTaskNodeId)

        if (ancestors.has(ctx.resolvedParentNodeId)) {
            return [{
                ruleId: 'grandparent_attachment',
                message: `Target parent "${ctx.resolvedParentNodeId}" is an ancestor of your task node "${ctx.callerTaskNodeId}". Attach to your task node or its descendants instead.`,
                nodeFilename: '__graph_root__',
                severity: 'violation',
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
                    message: `Node is too long (${bodyLines} lines, limit is ${ctx.lineLimit}). Do NOT shorten or remove any content — split into a TREE of nodes that mirrors the conceptual structure of your content, declaring parents via \`- parent [[other-filename|edge-label]]\` lines inside each child's \`content\` body to create branching, not a linear chain.`,
                    nodeFilename: node.filename,
                    severity: 'violation',
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

/**
 * Node attachment rule: each create_graph node must have an edge after the
 * batch is applied. Live/RPC creation supplies a graph-parent fallback for
 * root nodes, so this rule is normally a pass in daemon mode; filesystem-mode
 * `vt graph create` reuses the same rule ID when a markdown input has neither
 * a parent line nor an external --parent attachment.
 */
const nodeMustHaveEdgeRule: ValidationRule = {
    id: 'node_must_have_edge',
    description: 'Each created node must have at least one parent edge unless explicitly overridden.',
    check(ctx: ValidationContext): readonly RuleViolation[] {
        const violations: RuleViolation[] = []
        for (const node of ctx.nodes) {
            const hasAuthoredParent: boolean = extractParentRefs(node.content ?? '').length > 0
            const hasGraphParentFallback: boolean = ctx.resolvedParentNodeId.length > 0
            if (hasAuthoredParent || hasGraphParentFallback) continue
            violations.push({
                ruleId: 'node_must_have_edge',
                message: `Node "${node.filename}" has no parent edge and would be disconnected from the graph.`,
                nodeFilename: node.filename,
                severity: 'violation',
                details: {filename: node.filename},
            })
        }
        return violations
    },
}

/**
 * Subgraph size limit rule (auto folder gardening). Counts the folder-bounded
 * component the batch's nodes will join (post-insertion) and pushes back as the
 * cluster grows: a non-blocking `warning` at `subgraphWarnThreshold`, an
 * overridable `violation` at `subgraphErrorThreshold`. The destination folder is
 * the component that is actually growing (design Decision 1a).
 */
function folderNameOf(folderPath: string): string {
    const trimmed: string = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath
    return trimmed.slice(trimmed.lastIndexOf('/') + 1) || folderPath
}

const subgraphSizeLimitRule: ValidationRule = {
    id: daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId,
    description: 'Garden folder size: warn as a folder-bounded component approaches the limit, block (overridable) once it crosses it.',
    check(ctx: ValidationContext): readonly RuleViolation[] {
        const existingSize: number = countFolderBoundedComponent(
            ctx.graph, ctx.resolvedParentNodeId, ctx.destinationFolderPath,
        )
        const size: number = existingSize + ctx.nodes.length
        const folderName: string = folderNameOf(ctx.destinationFolderPath)
        const details: Record<string, unknown> = {
            folder: ctx.destinationFolderPath,
            folderName,
            size,
            warnThreshold: ctx.subgraphWarnThreshold,
            errorThreshold: ctx.subgraphErrorThreshold,
        }

        if (size >= ctx.subgraphErrorThreshold) {
            return [{
                ruleId: daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId,
                message: daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.formatViolationMessage(
                    folderName,
                    size,
                    ctx.subgraphErrorThreshold,
                ),
                nodeFilename: '__graph_root__',
                severity: 'violation',
                details,
            }]
        }
        if (size >= ctx.subgraphWarnThreshold) {
            return [{
                ruleId: daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId,
                message: `Folder "${folderName}" is reaching ${size} nodes (warn threshold ${ctx.subgraphWarnThreshold}, block at ${ctx.subgraphErrorThreshold}). Consider splitting into a sub-folder before it grows harder to navigate.`,
                nodeFilename: '__graph_root__',
                severity: 'warning',
                details,
            }]
        }
        return []
    },
}

// ----------------------------------------------------------------------------
// Shared parent-resolution helpers (child_count_limit + graph_complexity_limit)
// ----------------------------------------------------------------------------

function baseNameOf(nodeId: string): string {
    return nodeId.split('/').pop()?.replace(/\.md$/, '') ?? nodeId
}

/** Distinct in-batch parent refs of a node (deduped by normalized filename). */
function parentRefsOf(node: CreateGraphNodeInput): readonly ParentLineRef[] {
    const refs: readonly ParentLineRef[] = extractParentRefs(node.content ?? '')
    const seen: Set<string> = new Set()
    const unique: ParentLineRef[] = []
    for (const ref of refs) {
        const key: string = normalizeBatchFilenameKey(ref.filename)
        if (seen.has(key)) continue
        seen.add(key)
        unique.push(ref)
    }
    return unique
}

interface ResolvedParent {
    /** Stable identity used to tally children across the batch + graph. */
    readonly key: string
    /** The matching graph node id, if this parent already exists in the graph. */
    readonly graphNodeId: NodeIdAndFilePath | undefined
    /** Human-readable name for messages. */
    readonly displayName: string
}

/**
 * Resolve a parent-line ref to a stable tally key: an in-batch sibling
 * (`batch:<key>`), an existing graph node (its id), or an unresolved target
 * (`unresolved:<key>`). Mirrors createGraphBatch's resolveParentLinks lookup so
 * the gate counts the same edges the batch will author.
 */
function resolveParentRef(
    ref: ParentLineRef,
    ctx: ValidationContext,
    batchKeys: ReadonlySet<string>,
): ResolvedParent {
    const refKey: string = normalizeBatchFilenameKey(ref.filename)
    if (batchKeys.has(refKey)) {
        return {key: `batch:${refKey}`, graphNodeId: undefined, displayName: baseNameOf(ref.filename)}
    }
    const resolved: NodeIdAndFilePath | undefined =
        findBestMatchingNode(ref.filename, ctx.graph.nodes, ctx.graph.nodeByBaseName)
    if (resolved && ctx.graph.nodes[resolved]) {
        return {key: resolved, graphNodeId: resolved, displayName: baseNameOf(resolved)}
    }
    return {key: `unresolved:${refKey}`, graphNodeId: undefined, displayName: baseNameOf(ref.filename)}
}

/** Resolve every parent a batch node attaches to (fallback graph-parent when none authored). */
function resolvedParentsOf(
    node: CreateGraphNodeInput,
    ctx: ValidationContext,
    batchKeys: ReadonlySet<string>,
): readonly ResolvedParent[] {
    const refs: readonly ParentLineRef[] = parentRefsOf(node)
    if (refs.length === 0) {
        return [{
            key: ctx.resolvedParentNodeId,
            graphNodeId: ctx.resolvedParentNodeId,
            displayName: baseNameOf(ctx.resolvedParentNodeId),
        }]
    }
    return refs.map((ref: ParentLineRef) => resolveParentRef(ref, ctx, batchKeys))
}

/** Existing children of a node = nodes whose edges point to it (its incoming edges). */
function existingChildCount(graph: Graph, nodeId: NodeIdAndFilePath): number {
    return (graph.incomingEdgesIndex.get(nodeId) ?? []).length
}

/** Folders and context nodes legitimately hold many children — never limited. */
function isExemptParent(graph: Graph, nodeId: NodeIdAndFilePath): boolean {
    if (isFolderIdentityNote(nodeId)) return true
    return graph.nodes[nodeId]?.nodeUIMetadata.isContextNode === true
}

/**
 * Child-count limit rule: no single parent should gain so many children that the
 * graph becomes an unstructured star instead of a navigable tree. Counts each
 * parent's post-insertion children (existing incoming edges + children authored
 * in this batch) and blocks (overridable) any parent over the limit. Folder
 * notes and context nodes are exempt — they are containers by design.
 */
const childCountLimitRule: ValidationRule = {
    id: 'child_count_limit',
    description: 'No node may exceed the configured number of children (overridable) — build trees, not wide stars.',
    check(ctx: ValidationContext): readonly RuleViolation[] {
        const batchKeys: ReadonlySet<string> =
            new Set(ctx.nodes.map((n: CreateGraphNodeInput) => normalizeBatchFilenameKey(n.filename)))

        interface Tally {added: number; existing: number; exempt: boolean; name: string}
        const tallies: Map<string, Tally> = new Map()

        for (const node of ctx.nodes) {
            for (const parent of resolvedParentsOf(node, ctx, batchKeys)) {
                let tally: Tally | undefined = tallies.get(parent.key)
                if (!tally) {
                    tally = {
                        added: 0,
                        existing: parent.graphNodeId ? existingChildCount(ctx.graph, parent.graphNodeId) : 0,
                        exempt: parent.graphNodeId ? isExemptParent(ctx.graph, parent.graphNodeId) : false,
                        name: parent.displayName,
                    }
                    tallies.set(parent.key, tally)
                }
                tally.added++
            }
        }

        const violations: RuleViolation[] = []
        for (const [, tally] of tallies) {
            if (tally.exempt) continue
            const total: number = tally.existing + tally.added
            if (total > ctx.maxChildrenPerNode) {
                violations.push({
                    ruleId: 'child_count_limit',
                    message: `Node "${tally.name}" would have ${total} children (limit ${ctx.maxChildrenPerNode}). Build a TREE: group these under intermediate nodes (declare \`- parent [[intermediate-node]]\`) instead of attaching them all to one parent.`,
                    nodeFilename: '__graph_root__',
                    severity: 'violation',
                    details: {
                        parent: tally.name,
                        childCount: total,
                        existingChildren: tally.existing,
                        addedChildren: tally.added,
                        limit: ctx.maxChildrenPerNode,
                    },
                })
            }
        }
        return violations
    },
}

/**
 * Build the post-insertion edge list (directed child→parent, matching
 * `vt graph complexity`'s loadProjectGraph) over the destination-folder
 * component plus the batch's new nodes. Edges to nodes outside the considered
 * set are dropped so the measure reflects the local cluster only.
 */
function buildComponentComplexity(ctx: ValidationContext): GraphComplexityResult {
    const componentIds: ReadonlySet<NodeIdAndFilePath> =
        collectFolderBoundedComponent(ctx.graph, ctx.resolvedParentNodeId, ctx.destinationFolderPath)
    const batchKeys: ReadonlySet<string> =
        new Set(ctx.nodes.map((n: CreateGraphNodeInput) => normalizeBatchFilenameKey(n.filename)))
    const newNodeKey = (filename: string): string => `batch:${normalizeBatchFilenameKey(filename)}`

    const nodeIdSet: Set<string> = new Set<string>([...componentIds, ctx.resolvedParentNodeId])
    for (const node of ctx.nodes) nodeIdSet.add(newNodeKey(node.filename))

    const edges: EdgePair[] = []
    // Existing edges among the component (and the seed parent) that stay in-set.
    const existingSources: Set<string> = new Set<string>([...componentIds, ctx.resolvedParentNodeId])
    for (const id of existingSources) {
        for (const edge of ctx.graph.nodes[id]?.outgoingEdges ?? []) {
            if (edge.targetId !== id && nodeIdSet.has(edge.targetId)) {
                edges.push({src: id, tgt: edge.targetId})
            }
        }
    }
    // New edges this batch authors (child→parent), keyed to match nodeIdSet.
    for (const node of ctx.nodes) {
        const src: string = newNodeKey(node.filename)
        for (const parent of resolvedParentsOf(node, ctx, batchKeys)) {
            const tgt: string = parent.graphNodeId ?? parent.key
            if (tgt !== src && nodeIdSet.has(tgt)) edges.push({src, tgt})
        }
    }

    return computeGraphComplexity([...nodeIdSet], edges)
}

/**
 * Graph-complexity limit rule: runs the same complexity measure as
 * `vt graph complexity` over the destination-folder component (after this batch
 * lands) and pushes back as the cluster gets harder to comprehend — a
 * non-blocking warning at `complexityWarnScore`, an overridable block at
 * `complexityBlockScore` (≈ the 'heavy' boundary). Catches tangled/mesh growth
 * that the per-parent child_count_limit (a single hub) does not.
 */
const graphComplexityLimitRule: ValidationRule = {
    id: 'graph_complexity_limit',
    description: 'The destination cluster\'s graph-complexity score must stay below the configured block threshold (overridable).',
    check(ctx: ValidationContext): readonly RuleViolation[] {
        const result: GraphComplexityResult = buildComponentComplexity(ctx)
        const folderName: string = folderNameOf(ctx.destinationFolderPath)
        const details: Record<string, unknown> = {
            folder: ctx.destinationFolderPath,
            folderName,
            score: result.score,
            rating: result.rating,
            cyclic: result.cyclic,
            warnScore: ctx.complexityWarnScore,
            blockScore: ctx.complexityBlockScore,
        }

        if (result.score >= ctx.complexityBlockScore) {
            return [{
                ruleId: 'graph_complexity_limit',
                message: `Cluster "${folderName}" would reach complexity score ${result.score} (${result.rating.toUpperCase()}), at or above the block threshold ${ctx.complexityBlockScore}. Restructure the cluster — split it into sub-folders, reduce cross-links, or flatten redundant branching — so it stays comprehensible.`,
                nodeFilename: '__graph_root__',
                severity: 'violation',
                details,
            }]
        }
        if (result.score >= ctx.complexityWarnScore) {
            return [{
                ruleId: 'graph_complexity_limit',
                message: `Cluster "${folderName}" complexity is ${result.score} (${result.rating}, warn ${ctx.complexityWarnScore}, block ${ctx.complexityBlockScore}). Consider simplifying its structure before it grows harder to navigate.`,
                nodeFilename: '__graph_root__',
                severity: 'warning',
                details,
            }]
        }
        return []
    },
}

// ============================================================================
// Export
// ============================================================================

function createValidationRules(): readonly ValidationRule[] {
    return [grandparentAttachmentRule, nodeLineLimitRule, nodeMustHaveEdgeRule, subgraphSizeLimitRule, childCountLimitRule, graphComplexityLimitRule]
}

export const ALL_RULES: readonly ValidationRule[] = createValidationRules()
