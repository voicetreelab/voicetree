/**
 * Unit tests for createGraphValidation pure functions and individual rules.
 *
 * Tests runValidations, resolveOverrides, formatViolationError, and
 * the grandparent_attachment + node_line_limit rules in isolation.
 */

import {describe, it, expect} from 'vitest'
import type {Graph, NodeIdAndFilePath} from '@/pure/graph'
import {
    type ValidationContext,
    type ValidationResult,
    type RuleViolation,
    type OverrideEntry,
    type ValidationRuleId,
    ALL_RULES,
    runValidations,
    resolveOverrides,
    formatViolationError,
} from './createGraphValidation'
import {mockGraph, mockNode, linesOfText, buildCtx} from './createGraphValidation.testHelpers'

// ============================================================================
// runValidations
// ============================================================================

describe('runValidations', () => {
    it('returns pass when no rules are violated', () => {
        const graph: Graph = mockGraph(['/vault/task.md'])
        const ctx: ValidationContext = buildCtx({
            nodes: [mockNode({filename: 'small-node', title: 'T', summary: 'Short summary'})],
            resolvedParentNodeId: '/vault/task.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('pass')
    })

    it('collects violations from multiple rules simultaneously', () => {
        const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
            ['/vault/task.md', ['/vault/grandparent.md']],
        ])
        const graph: Graph = mockGraph(['/vault/task.md', '/vault/grandparent.md'], incomingEdges)
        const ctx: ValidationContext = buildCtx({
            nodes: [mockNode({filename: 'big-node', title: 'T', summary: linesOfText(80)})],
            resolvedParentNodeId: '/vault/grandparent.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
            lineLimit: 70,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('violations')
        if (result.status === 'violations') {
            const ruleIds: ValidationRuleId[] = result.violations.map((v: RuleViolation) => v.ruleId)
            expect(ruleIds).toContain('grandparent_attachment')
            expect(ruleIds).toContain('node_line_limit')
        }
    })

    it('returns pass with empty rules array', () => {
        const graph: Graph = mockGraph(['/vault/task.md'])
        const ctx: ValidationContext = buildCtx({resolvedParentNodeId: '/vault/task.md', graph})
        expect(runValidations([], ctx).status).toBe('pass')
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
            {ruleId: 'grandparent_attachment', message: 'Ancestor', nodeFilename: '__graph_root__', details: {}},
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
            {ruleId: 'grandparent_attachment', message: 'Ancestor', nodeFilename: '__graph_root__', details: {}},
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
            {ruleId: 'node_line_limit', message: 'Too long (80 lines)', nodeFilename: 'my-progress.md', details: {}},
        ])
        expect(error).toContain('node_line_limit')
        expect(error).toContain('my-progress.md')
        expect(error).toContain('Validation failed')
    })

    it('includes parseable JSON override example', () => {
        const error: string = formatViolationError([
            {ruleId: 'node_line_limit', message: 'Too long', nodeFilename: 'n.md', details: {}},
        ])
        expect(error).toContain('override_with_rationale')
        expect(error).toContain('"ruleId"')
        expect(error).toContain('"node_line_limit"')
        expect(error).toContain('<explain why this override is justified>')
    })

    it('deduplicates rule IDs in override example', () => {
        const error: string = formatViolationError([
            {ruleId: 'node_line_limit', message: 'Too long', nodeFilename: 'a', details: {}},
            {ruleId: 'node_line_limit', message: 'Too long', nodeFilename: 'b', details: {}},
        ])
        const parsed: unknown = JSON.parse(error.slice(error.indexOf('['), error.lastIndexOf(']') + 1))
        expect(Array.isArray(parsed)).toBe(true)
        expect((parsed as readonly {ruleId: string}[]).length).toBe(1)
    })

    it('lists multiple distinct rule IDs in override example', () => {
        const error: string = formatViolationError([
            {ruleId: 'node_line_limit', message: 'Too long', nodeFilename: 'n.md', details: {}},
            {ruleId: 'grandparent_attachment', message: 'Ancestor', nodeFilename: '__graph_root__', details: {}},
        ])
        const parsed: unknown = JSON.parse(error.slice(error.indexOf('['), error.lastIndexOf(']') + 1))
        expect((parsed as readonly {ruleId: string}[]).length).toBe(2)
    })
})

// ============================================================================
// nodeLineLimitRule
// ============================================================================

describe('nodeLineLimitRule (via ALL_RULES)', () => {
    it('passes when node body is under the line limit', () => {
        const graph: Graph = mockGraph(['/vault/task.md'])
        const ctx: ValidationContext = buildCtx({
            nodes: [mockNode({filename: 'ok', title: 'T', summary: linesOfText(30), content: linesOfText(30)})],
            resolvedParentNodeId: '/vault/task.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'node_line_limit')).toHaveLength(0)
        }
    })

    it('rejects when node body exceeds the line limit', () => {
        const graph: Graph = mockGraph(['/vault/task.md'])
        const ctx: ValidationContext = buildCtx({
            nodes: [mockNode({filename: 'big-node', title: 'T', summary: linesOfText(80)})],
            resolvedParentNodeId: '/vault/task.md',
            callerTaskNodeId: '/vault/task.md',
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
        const graph: Graph = mockGraph(['/vault/task.md'])
        const ctx: ValidationContext = buildCtx({
            nodes: [
                mockNode({filename: 'big-a', title: 'T', summary: linesOfText(75)}),
                mockNode({filename: 'big-b', title: 'T', summary: linesOfText(90)}),
                mockNode({filename: 'ok-c', title: 'T', summary: 'Short'}),
            ],
            resolvedParentNodeId: '/vault/task.md',
            callerTaskNodeId: '/vault/task.md',
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
        const graph: Graph = mockGraph(['/vault/task.md'])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/vault/task.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
        }))
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'grandparent_attachment')).toHaveLength(0)
        }
    })

    it('passes when callerTaskNodeId is null (user terminal)', () => {
        const graph: Graph = mockGraph(['/vault/some-node.md'])
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/vault/some-node.md',
            callerTaskNodeId: null,
            graph,
        }))
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'grandparent_attachment')).toHaveLength(0)
        }
    })

    it('rejects when attaching to a direct ancestor of the task node', () => {
        const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
            ['/vault/task.md', ['/vault/grandparent.md']],
        ])
        const graph: Graph = mockGraph(['/vault/task.md', '/vault/grandparent.md'], incomingEdges)
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/vault/grandparent.md',
            callerTaskNodeId: '/vault/task.md',
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
            ['/vault/task.md', ['/vault/gp.md']],
            ['/vault/gp.md', ['/vault/ggp.md']],
        ])
        const graph: Graph = mockGraph(['/vault/task.md', '/vault/gp.md', '/vault/ggp.md'], incomingEdges)
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/vault/ggp.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
        }))
        expect(result.status).toBe('violations')
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'grandparent_attachment')).toHaveLength(1)
        }
    })

    it('passes when attaching to a non-ancestor node', () => {
        const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
            ['/vault/task.md', ['/vault/grandparent.md']],
        ])
        const graph: Graph = mockGraph(['/vault/task.md', '/vault/grandparent.md', '/vault/sibling.md'], incomingEdges)
        const result: ValidationResult = runValidations(ALL_RULES, buildCtx({
            nodes: [mockNode({filename: 'n', title: 'T', summary: 'S'})],
            resolvedParentNodeId: '/vault/sibling.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
        }))
        if (result.status === 'violations') {
            expect(result.violations.filter((v: RuleViolation) => v.ruleId === 'grandparent_attachment')).toHaveLength(0)
        }
    })
})
