/**
 * Unit tests for createGraphValidation pure functions and individual rules.
 *
 * Tests runValidations, resolveOverrides, formatViolationError, and
 * the grandparent_attachment + node_line_limit rules in isolation.
 */

import {describe, it, expect} from 'vitest'
import type {Graph, NodeIdAndFilePath} from '@vt/graph-model/graph'
import * as daemonProtocol from '@vt/vt-daemon-protocol'
import {
    type ValidationContext,
    type ValidationResult,
    type RuleViolation,
    ALL_RULES,
    runValidations,
    resolveOverrides,
    formatViolationError,
    partitionViolationsBySeverity,
} from './createGraphValidation'
import {
    type OverrideEntry,
    type OverridableRuleId,
} from '@vt/graph-validation'
import {mockGraph, mockNode, linesOfText, buildCtx} from './createGraphValidation.testHelpers'

// ============================================================================
// runValidations
// ============================================================================

describe('runValidations', () => {
    it('returns pass when no rules are violated', () => {
        const graph: Graph = mockGraph(['/project/task.md'])
        const ctx: ValidationContext = buildCtx({
            nodes: [mockNode({filename: 'small-node', title: 'T', summary: 'Short summary'})],
            resolvedParentNodeId: '/project/task.md',
            callerTaskNodeId: '/project/task.md',
            graph,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('pass')
    })

    it('collects violations from multiple rules simultaneously', () => {
        const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
            ['/project/task.md', ['/project/grandparent.md']],
        ])
        const graph: Graph = mockGraph(['/project/task.md', '/project/grandparent.md'], incomingEdges)
        const ctx: ValidationContext = buildCtx({
            nodes: [mockNode({filename: 'big-node', title: 'T', summary: linesOfText(80)})],
            resolvedParentNodeId: '/project/grandparent.md',
            callerTaskNodeId: '/project/task.md',
            graph,
            lineLimit: 70,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('violations')
        if (result.status === 'violations') {
            const ruleIds: OverridableRuleId[] = result.violations.map((v: RuleViolation) => v.ruleId)
            expect(ruleIds).toContain('grandparent_attachment')
            expect(ruleIds).toContain('node_line_limit')
        }
    })

    it('returns pass with empty rules array', () => {
        const graph: Graph = mockGraph(['/project/task.md'])
        const ctx: ValidationContext = buildCtx({resolvedParentNodeId: '/project/task.md', graph})
        expect(runValidations([], ctx).status).toBe('pass')
    })
})

// ============================================================================
// partitionViolationsBySeverity
// ============================================================================

describe('partitionViolationsBySeverity', () => {
    const blockingViolation: RuleViolation = {
        ruleId: 'node_line_limit', message: 'Too long', nodeFilename: 'n', severity: 'violation', details: {},
    }
    const warningViolation: RuleViolation = {
        ruleId: 'node_line_limit', message: 'Approaching limit', nodeFilename: '__graph_root__', severity: 'warning', details: {},
    }

    it('splits warnings from blocking violations', () => {
        const {warnings, blocking} = partitionViolationsBySeverity([blockingViolation, warningViolation])
        expect(warnings).toEqual([warningViolation])
        expect(blocking).toEqual([blockingViolation])
    })

    it('returns empty partitions for an empty input', () => {
        const {warnings, blocking} = partitionViolationsBySeverity([])
        expect(warnings).toHaveLength(0)
        expect(blocking).toHaveLength(0)
    })

    it('keeps all results when they share one severity', () => {
        expect(partitionViolationsBySeverity([blockingViolation, blockingViolation]).warnings).toHaveLength(0)
        expect(partitionViolationsBySeverity([warningViolation, warningViolation]).blocking).toHaveLength(0)
    })
})

// ============================================================================
// resolveOverrides
// ============================================================================

describe('resolveOverrides', () => {
    const sampleViolation: RuleViolation = {
        ruleId: 'node_line_limit',
        message: 'Too long',
        nodeFilename: 'big-node',
        severity: 'violation',
        details: {bodyLines: 80, lineLimit: 70},
    }

    it('returns all violations as unresolved when no overrides provided', () => {
        const {unresolved, accepted} = resolveOverrides([sampleViolation], [])
        expect(unresolved).toHaveLength(1)
        expect(accepted).toHaveLength(0)
    })

    it('resolves a violation when matching override is provided', () => {
        const override: OverrideEntry = {ruleId: 'node_line_limit', rationale: 'Indivisible code block'}
        const {unresolved, accepted} = resolveOverrides([sampleViolation], [override])
        expect(unresolved).toHaveLength(0)
        expect(accepted).toHaveLength(1)
        expect(accepted[0].rationale).toBe('Indivisible code block')
    })

    it('leaves unmatched violations unresolved when override targets different rule', () => {
        const override: OverrideEntry = {ruleId: 'grandparent_attachment', rationale: 'Intentional'}
        const {unresolved} = resolveOverrides([sampleViolation], [override])
        expect(unresolved).toHaveLength(1)
        expect(unresolved[0].ruleId).toBe('node_line_limit')
    })

    it('handles partial override: resolves only matching violations', () => {
        const violations: RuleViolation[] = [
            sampleViolation,
            {ruleId: 'grandparent_attachment', message: 'Ancestor', nodeFilename: '__graph_root__', severity: 'violation', details: {}},
        ]
        const {unresolved, accepted} = resolveOverrides(violations, [
            {ruleId: 'node_line_limit', rationale: 'Large code block'},
        ])
        expect(unresolved).toHaveLength(1)
        expect(unresolved[0].ruleId).toBe('grandparent_attachment')
        expect(accepted).toHaveLength(1)
    })

    it('resolves all violations when all have matching overrides', () => {
        const violations: RuleViolation[] = [
            sampleViolation,
            {ruleId: 'grandparent_attachment', message: 'Ancestor', nodeFilename: '__graph_root__', severity: 'violation', details: {}},
        ]
        const {unresolved, accepted} = resolveOverrides(violations, [
            {ruleId: 'node_line_limit', rationale: 'Large code block'},
            {ruleId: 'grandparent_attachment', rationale: 'Intentional visibility'},
        ])
        expect(unresolved).toHaveLength(0)
        expect(accepted).toHaveLength(2)
    })
})

// ============================================================================
// formatViolationError
// ============================================================================

describe('formatViolationError', () => {
    it('includes rule ID, node filename, and "Validation failed" header', () => {
        const error: string = formatViolationError([
            {ruleId: 'node_line_limit', message: 'Too long (80 lines)', nodeFilename: 'my-progress.md', severity: 'violation', details: {}},
        ])
        expect(error).toContain('node_line_limit')
        expect(error).toContain('my-progress.md')
        expect(error).toContain('Validation failed')
    })

    it('includes parseable JSON override example', () => {
        const error: string = formatViolationError([
            {ruleId: 'node_line_limit', message: 'Too long', nodeFilename: 'n.md', severity: 'violation', details: {}},
        ])
        expect(error).toContain('override_with_rationale')
        expect(error).toContain('"ruleId"')
        expect(error).toContain('"node_line_limit"')
        expect(error).toContain('<explain why this override is justified>')
    })

    it('deduplicates rule IDs in override example', () => {
        const error: string = formatViolationError([
            {ruleId: 'node_line_limit', message: 'Too long', nodeFilename: 'a', severity: 'violation', details: {}},
            {ruleId: 'node_line_limit', message: 'Too long', nodeFilename: 'b', severity: 'violation', details: {}},
        ])
        // Extract JSON after the "override_with_rationale" instruction line
        const jsonStart: number = error.indexOf('[\n')
        const parsed: unknown = JSON.parse(error.slice(jsonStart))
        expect(Array.isArray(parsed)).toBe(true)
        expect((parsed as readonly {ruleId: string}[]).length).toBe(1)
    })

    it('lists multiple distinct rule IDs in override example', () => {
        const error: string = formatViolationError([
            {ruleId: 'node_line_limit', message: 'Too long', nodeFilename: 'n.md', severity: 'violation', details: {}},
            {ruleId: 'grandparent_attachment', message: 'Ancestor', nodeFilename: '__graph_root__', severity: 'violation', details: {}},
            {ruleId: 'node_must_have_edge', message: 'No edge', nodeFilename: 'lonely.md', severity: 'violation', details: {}},
        ])
        const jsonStart: number = error.indexOf('[\n')
        const parsed: unknown = JSON.parse(error.slice(jsonStart))
        expect((parsed as readonly {ruleId: string}[]).length).toBe(3)
    })
})

// ============================================================================
// nodeLineLimitRule
// ============================================================================

describe('nodeLineLimitRule (via ALL_RULES)', () => {
    it('passes when node body is under the line limit', () => {
        const graph: Graph = mockGraph(['/project/task.md'])
        const ctx: ValidationContext = buildCtx({
            nodes: [mockNode({filename: 'ok', title: 'T', summary: linesOfText(30), content: linesOfText(30)})],
            resolvedParentNodeId: '/project/task.md',
            callerTaskNodeId: '/project/task.md',
            graph,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'node_line_limit')).toHaveLength(0)
        }
    })

    it('rejects when node body exceeds the line limit', () => {
        const graph: Graph = mockGraph(['/project/task.md'])
        const ctx: ValidationContext = buildCtx({
            nodes: [mockNode({filename: 'big-node', title: 'T', summary: linesOfText(80)})],
            resolvedParentNodeId: '/project/task.md',
            callerTaskNodeId: '/project/task.md',
            graph,
            lineLimit: 70,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('violations')
        if (result.status === 'violations') {
            const lv: readonly RuleViolation[] = result.violations.filter((v: RuleViolation) => v.ruleId === 'node_line_limit')
            expect(lv).toHaveLength(1)
            expect(lv[0].nodeFilename).toBe('big-node')
            expect(lv[0].details).toMatchObject({bodyLines: 80, lineLimit: 70})
        }
    })

    it('reports multiple oversized nodes independently', () => {
        const graph: Graph = mockGraph(['/project/task.md'])
        const ctx: ValidationContext = buildCtx({
            nodes: [
                mockNode({filename: 'big-a', title: 'T', summary: linesOfText(75)}),
                mockNode({filename: 'big-b', title: 'T', summary: linesOfText(90)}),
                mockNode({filename: 'ok-c', title: 'T', summary: 'Short'}),
            ],
            resolvedParentNodeId: '/project/task.md',
            callerTaskNodeId: '/project/task.md',
            graph,
            lineLimit: 70,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('violations')
        if (result.status === 'violations') {
            const lv: readonly RuleViolation[] = result.violations.filter((v: RuleViolation) => v.ruleId === 'node_line_limit')
            expect(lv).toHaveLength(2)
            expect(lv.map((v: RuleViolation) => v.nodeFilename)).toContain('big-a')
            expect(lv.map((v: RuleViolation) => v.nodeFilename)).toContain('big-b')
        }
    })
})

// ============================================================================
// grandparentAttachmentRule
// ============================================================================

describe('grandparentAttachmentRule (via ALL_RULES)', () => {
    it('passes when attaching to own task node', () => {
        const graph: Graph = mockGraph(['/project/task.md'])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/task.md',
            callerTaskNodeId: '/project/task.md',
            graph,
        }))
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'grandparent_attachment')).toHaveLength(0)
        }
    })

    it('passes when callerTaskNodeId is null (user terminal)', () => {
        const graph: Graph = mockGraph(['/project/some-node.md'])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/some-node.md',
            callerTaskNodeId: null,
            graph,
        }))
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'grandparent_attachment')).toHaveLength(0)
        }
    })

    it('rejects when attaching to a direct ancestor of the task node', () => {
        const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
            ['/project/task.md', ['/project/grandparent.md']],
        ])
        const graph: Graph = mockGraph(['/project/task.md', '/project/grandparent.md'], incomingEdges)
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/grandparent.md',
            callerTaskNodeId: '/project/task.md',
            graph,
        }))
        expect(result.status).toBe('violations')
        if (result.status === 'violations') {
            const gp: readonly RuleViolation[] = result.violations.filter((v: RuleViolation) => v.ruleId === 'grandparent_attachment')
            expect(gp).toHaveLength(1)
            expect(gp[0].nodeFilename).toBe('__graph_root__')
        }
    })

    it('rejects when attaching to a deep ancestor (great-grandparent)', () => {
        const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
            ['/project/task.md', ['/project/gp.md']],
            ['/project/gp.md', ['/project/ggp.md']],
        ])
        const graph: Graph = mockGraph(['/project/task.md', '/project/gp.md', '/project/ggp.md'], incomingEdges)
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/ggp.md',
            callerTaskNodeId: '/project/task.md',
            graph,
        }))
        expect(result.status).toBe('violations')
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'grandparent_attachment')).toHaveLength(1)
        }
    })

    it('passes when attaching to a non-ancestor node', () => {
        const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
            ['/project/task.md', ['/project/grandparent.md']],
        ])
        const graph: Graph = mockGraph(['/project/task.md', '/project/grandparent.md', '/project/sibling.md'], incomingEdges)
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/sibling.md',
            callerTaskNodeId: '/project/task.md',
            graph,
        }))
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'grandparent_attachment')).toHaveLength(0)
        }
    })
})

// ============================================================================
// subgraphSizeLimitRule
// ============================================================================

describe('subgraphSizeLimitRule (via ALL_RULES)', () => {
    /** A folder f/ whose node A has `childCount` children that all point to A (child -> A). */
    function folderGraph(childCount: number): Graph {
        const children: string[] = Array.from({length: childCount}, (_, i) => `f/child${i}.md`)
        const incoming: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> =
            new Map([['f/A.md', children]])
        return mockGraph(['f/A.md', ...children], incoming)
    }

    function subgraphCtx(graph: Graph, batchSize: number): ValidationContext {
        return buildCtx({
            nodes: Array.from({length: batchSize}, (_, i) =>
                mockNode({filename: `new${i}`, title: 'T', summary: 'S'})),
            resolvedParentNodeId: 'f/A.md',
            callerTaskNodeId: 'f/A.md', // attaching to own task node — no grandparent violation
            graph,
            destinationFolderPath: 'f/',
            subgraphWarnThreshold: 4,
            subgraphErrorThreshold: 6,
        })
    }

    function subgraphViolations(result: ValidationResult): readonly RuleViolation[] {
        return result.status === 'violations'
            ? result.violations.filter((v: RuleViolation) => v.ruleId === daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId)
            : []
    }

    it('passes (no subgraph result) below the warn threshold', () => {
        // existing component = 1 (A) + batch 1 = 2 < warn(4)
        const result: ValidationResult = runValidations(ALL_RULES, subgraphCtx(folderGraph(0), 1))
        expect(subgraphViolations(result)).toHaveLength(0)
    })

    it('emits a non-blocking warning in [warn, error)', () => {
        // existing component = 3 (A + 2 children) + batch 1 = 4 == warn(4)
        const result: ValidationResult = runValidations(ALL_RULES, subgraphCtx(folderGraph(2), 1))
        const sg: readonly RuleViolation[] = subgraphViolations(result)
        expect(sg).toHaveLength(1)
        expect(sg[0].severity).toBe('warning')
        expect(sg[0].message).toContain('"f"')
        expect(sg[0].details).toMatchObject({size: 4, folder: 'f/'})
    })

    it('emits a blocking violation at the error threshold, evaluated over the whole batch', () => {
        // existing component = 3 (A + 2 children) + batch 3 = 6 == error(6)
        const result: ValidationResult = runValidations(ALL_RULES, subgraphCtx(folderGraph(2), 3))
        const sg: readonly RuleViolation[] = subgraphViolations(result)
        expect(sg).toHaveLength(1)
        expect(sg[0].severity).toBe('violation')
        expect(sg[0].details).toMatchObject({size: 6})
        expect(sg[0].message).toContain(daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.gardeningInstruction)
        expect(sg[0].message).toContain(daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.noRoutineOverrideInstruction)
    })

    it('presents the 3-option guided flow: accept grouping, choose manually, or bypass with a rationale', () => {
        const result: ValidationResult = runValidations(ALL_RULES, subgraphCtx(folderGraph(2), 3))
        const sg: readonly RuleViolation[] = subgraphViolations(result)
        const message: string = formatViolationError(sg)
        expect(message).toContain(daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.gardeningInstruction)
        // [1] accept the auto-grouping (via `vt graph garden … --apply`)
        expect(message).toContain('vt graph garden')
        // [2] reject and choose manually (editable plan)
        expect(message).toContain('--plan')
        // [3] bypass, only if absolutely necessary, with a rationale
        expect(message).toContain('override_with_rationale')
        expect(message).toContain(daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.noRoutineOverrideInstruction)
    })

    it('is admitted by a matching override_with_rationale', () => {
        const result: ValidationResult = runValidations(ALL_RULES, subgraphCtx(folderGraph(2), 3))
        const {blocking} = partitionViolationsBySeverity(
            result.status === 'violations' ? result.violations : [],
        )
        const override: OverrideEntry = {ruleId: daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId, rationale: 'Cohesive cluster, splitting would harm legibility'}
        const {unresolved} = resolveOverrides(blocking, [override])
        expect(unresolved.filter((v: RuleViolation) => v.ruleId === daemonProtocol.SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId)).toHaveLength(0)
    })
})

describe('nodeMustHaveEdgeRule (via ALL_RULES)', () => {
    it('passes when daemon graph-parent fallback is present', () => {
        const graph: Graph = mockGraph(['/project/task.md'])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/task.md',
            graph,
        }))
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'node_must_have_edge')).toHaveLength(0)
        }
    })

    it('passes when a node authors a parent line', () => {
        const graph: Graph = mockGraph([])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S', content: '- parent [[existing]]'})],
            resolvedParentNodeId: '' as NodeIdAndFilePath,
            graph,
        }))
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'node_must_have_edge')).toHaveLength(0)
        }
    })

    it('rejects when neither parent line nor graph-parent fallback is present', () => {
        const graph: Graph = mockGraph([])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'lonely', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '' as NodeIdAndFilePath,
            graph,
        }))
        expect(result.status).toBe('violations')
        if (result.status === 'violations') {
            const violations: readonly RuleViolation[] =
                result.violations.filter((v: RuleViolation) => v.ruleId === 'node_must_have_edge')
            expect(violations).toHaveLength(1)
            expect(violations[0].nodeFilename).toBe('lonely')
        }
    })
})

// ============================================================================
// child_count_limit rule
// ============================================================================

function childCountViolations(result: ValidationResult): readonly RuleViolation[] {
    return result.status === 'violations'
        ? result.violations.filter((v: RuleViolation) => v.ruleId === 'child_count_limit' && v.severity === 'violation')
        : []
}

describe('child_count_limit rule', () => {
    it('blocks when one parent gains more than the limit of children in a single batch', () => {
        const graph: Graph = mockGraph(['/project/hub.md'])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: Array.from({length: 5}, (_: unknown, i: number) =>
                mockNode({filename: `child-${i}`, title: 'T', summary: 'S'})),
            resolvedParentNodeId: '/project/hub.md',
            graph,
        }))
        const violations: readonly RuleViolation[] = childCountViolations(result)
        expect(violations).toHaveLength(1)
        expect(violations[0].details.childCount).toBe(5)
        expect(violations[0].details.limit).toBe(4)
    })

    it('counts existing children plus the batch (cross-batch accumulation)', () => {
        const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
            ['/project/hub.md', ['/project/c1.md', '/project/c2.md', '/project/c3.md']],
        ])
        const graph: Graph = mockGraph(
            ['/project/hub.md', '/project/c1.md', '/project/c2.md', '/project/c3.md'],
            incomingEdges,
        )
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [
                mockNode({filename: 'c4', title: 'T', summary: 'S'}),
                mockNode({filename: 'c5', title: 'T', summary: 'S'}),
            ],
            resolvedParentNodeId: '/project/hub.md',
            graph,
        }))
        const violations: readonly RuleViolation[] = childCountViolations(result)
        expect(violations).toHaveLength(1)
        expect(violations[0].details.existingChildren).toBe(3)
        expect(violations[0].details.addedChildren).toBe(2)
        expect(violations[0].details.childCount).toBe(5)
    })

    it('passes at exactly the limit', () => {
        const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
            ['/project/hub.md', ['/project/c1.md', '/project/c2.md']],
        ])
        const graph: Graph = mockGraph(['/project/hub.md', '/project/c1.md', '/project/c2.md'], incomingEdges)
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [
                mockNode({filename: 'c3', title: 'T', summary: 'S'}),
                mockNode({filename: 'c4', title: 'T', summary: 'S'}),
            ],
            resolvedParentNodeId: '/project/hub.md',
            graph,
        }))
        expect(childCountViolations(result)).toHaveLength(0)
    })

    it('counts an in-batch parent gaining many children', () => {
        const graph: Graph = mockGraph(['/project/root.md'])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [
                mockNode({filename: 'hub', title: 'T', summary: 'S'}),
                ...Array.from({length: 5}, (_: unknown, i: number) =>
                    mockNode({filename: `leaf-${i}`, title: 'T', summary: 'S', content: '- parent [[hub]]'})),
            ],
            resolvedParentNodeId: '/project/root.md',
            graph,
        }))
        const violations: readonly RuleViolation[] = childCountViolations(result)
        expect(violations).toHaveLength(1)
        expect(violations[0].details.parent).toBe('hub')
        expect(violations[0].details.childCount).toBe(5)
    })

    it('exempts folder identity notes (containers hold many children by design)', () => {
        const folderNote: NodeIdAndFilePath = '/project/foo/foo.md'
        const graph: Graph = mockGraph([folderNote])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: Array.from({length: 8}, (_: unknown, i: number) =>
                mockNode({filename: `child-${i}`, title: 'T', summary: 'S'})),
            resolvedParentNodeId: folderNote,
            graph,
        }))
        expect(childCountViolations(result)).toHaveLength(0)
    })

    it('is overridable with a rationale', () => {
        const graph: Graph = mockGraph(['/project/hub.md'])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: Array.from({length: 6}, (_: unknown, i: number) =>
                mockNode({filename: `child-${i}`, title: 'T', summary: 'S'})),
            resolvedParentNodeId: '/project/hub.md',
            graph,
        }))
        const blocking: readonly RuleViolation[] = childCountViolations(result)
        const overrides: readonly OverrideEntry[] = [{ruleId: 'child_count_limit', rationale: 'flat index node'}]
        const {unresolved} = resolveOverrides(blocking, overrides)
        expect(unresolved).toHaveLength(0)
    })
})

// ============================================================================
// folder_child_count_limit rule (live-gardening prevention)
// ============================================================================

function folderChildViolations(result: ValidationResult): readonly RuleViolation[] {
    return result.status === 'violations'
        ? result.violations.filter((v: RuleViolation) => v.ruleId === 'folder_child_count_limit' && v.severity === 'violation')
        : []
}

/** A folder node: its identity note plus `count` direct member leaves. */
function folderWithMembers(folderPath: string, count: number): Graph {
    const folderName: string = folderPath.replace(/\/$/, '').split('/').pop() ?? folderPath
    const identityNote: string = `${folderPath}${folderName}.md`
    const members: string[] = Array.from({length: count}, (_: unknown, i: number) => `${folderPath}member-${i}.md`)
    return mockGraph([identityNote, ...members])
}

describe('folder_child_count_limit rule', () => {
    it('exempts a directory with no folder identity note (e.g. the graph root)', () => {
        // /project/ has many members but no /project/project.md → not an established folder node.
        const graph: Graph = mockGraph(
            Array.from({length: 12}, (_: unknown, i: number) => `/project/n-${i}.md`),
        )
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'more', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/n-0.md',
            destinationFolderPath: '/project/',
            graph,
        }))
        expect(folderChildViolations(result)).toHaveLength(0)
    })

    it('passes when an established folder stays at or under the cap', () => {
        const graph: Graph = folderWithMembers('/project/foo/', 3)
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [
                mockNode({filename: 'a', title: 'T', summary: 'S'}),
                mockNode({filename: 'b', title: 'T', summary: 'S'}),
            ],
            resolvedParentNodeId: '/project/foo/foo.md',
            destinationFolderPath: '/project/foo/',
            maxFolderChildren: 5,
            graph,
        }))
        expect(folderChildViolations(result)).toHaveLength(0)
    })

    it('blocks when existing members plus the batch exceed the cap', () => {
        const graph: Graph = folderWithMembers('/project/foo/', 5)
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: Array.from({length: 3}, (_: unknown, i: number) =>
                mockNode({filename: `extra-${i}`, title: 'T', summary: 'S'})),
            resolvedParentNodeId: '/project/foo/foo.md',
            destinationFolderPath: '/project/foo/',
            maxFolderChildren: 7,
            graph,
        }))
        const violations: readonly RuleViolation[] = folderChildViolations(result)
        expect(violations).toHaveLength(1)
        expect(violations[0].details).toMatchObject({
            existingMembers: 5,
            addedMembers: 3,
            directMembers: 8,
            limit: 7,
        })
        expect(violations[0].nodeFilename).toBe('__graph_root__')
    })

    it('excludes the identity note and context nodes from the count (different axis from child_count_limit)', () => {
        // Folder with identity note + 6 real members + 1 context node. Adding 1 → 7 real members.
        // If the identity note or context node were counted, this would breach a cap of 7.
        const graph: Graph = folderWithMembers('/project/foo/', 6)
        const contextNodeId: NodeIdAndFilePath = '/project/foo/ctx.md'
        graph.nodes[contextNodeId] = {
            ...graph.nodes['/project/foo/member-0.md'],
            absoluteFilePathIsID: contextNodeId,
            nodeUIMetadata: {...graph.nodes['/project/foo/member-0.md'].nodeUIMetadata, isContextNode: true},
        }
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'seventh', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/foo/foo.md',
            destinationFolderPath: '/project/foo/',
            maxFolderChildren: 7,
            graph,
        }))
        expect(folderChildViolations(result)).toHaveLength(0)
    })

    it('is overridable with a rationale', () => {
        const graph: Graph = folderWithMembers('/project/foo/', 8)
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'more', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/foo/foo.md',
            destinationFolderPath: '/project/foo/',
            maxFolderChildren: 7,
            graph,
        }))
        const blocking: readonly RuleViolation[] = folderChildViolations(result)
        expect(blocking).toHaveLength(1)
        const overrides: readonly OverrideEntry[] = [{ruleId: 'folder_child_count_limit', rationale: 'curated index folder'}]
        const {unresolved} = resolveOverrides(blocking, overrides)
        expect(unresolved).toHaveLength(0)
    })
})

// ============================================================================
// graph_complexity_limit rule
// ============================================================================

describe('graph_complexity_limit rule', () => {
    it('does not block a small clean batch under default thresholds', () => {
        const graph: Graph = mockGraph(['/project/task.md'])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/task.md',
            graph,
        }))
        const blocking: readonly RuleViolation[] = result.status === 'violations'
            ? result.violations.filter((v: RuleViolation) => v.ruleId === 'graph_complexity_limit' && v.severity === 'violation')
            : []
        expect(blocking).toHaveLength(0)
    })

    it('blocks (overridable) once the destination cluster crosses the block score', () => {
        const graph: Graph = mockGraph(['/project/p.md'])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/project/p.md',
            graph,
            complexityBlockScore: 0.1,
            complexityWarnScore: 0.05,
        }))
        const blocking: readonly RuleViolation[] = result.status === 'violations'
            ? result.violations.filter((v: RuleViolation) => v.ruleId === 'graph_complexity_limit' && v.severity === 'violation')
            : []
        expect(blocking).toHaveLength(1)
        expect(typeof blocking[0].details.score).toBe('number')

        const overrides: readonly OverrideEntry[] = [{ruleId: 'graph_complexity_limit', rationale: 'inherently dense domain'}]
        const {unresolved} = resolveOverrides(blocking, overrides)
        expect(unresolved).toHaveLength(0)
    })
})
