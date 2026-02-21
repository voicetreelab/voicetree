/**
 * E2E-style tests for the override_with_rationale validation flow.
 *
 * Mimics the real agent experience:
 * 1. Agent calls create_graph with a violation → gets REJECTED with helpful error
 * 2. Agent retries with override_with_rationale → SUCCEEDS
 *
 * Tests the full pipeline: runValidations → resolveOverrides → formatViolationError.
 */

import {describe, it, expect} from 'vitest'
import type {Graph, NodeIdAndFilePath} from '@/pure/graph'
import type {CreateGraphNodeInput} from './createGraphTool'
import {
    type ValidationContext,
    type ValidationResult,
    type RuleViolation,
    type ValidationRuleId,
    ALL_RULES,
    runValidations,
    resolveOverrides,
    formatViolationError,
} from './createGraphValidation'
import {mockGraph, mockNode, linesOfText, buildCtx} from './createGraphValidation.testHelpers'

// ============================================================================
// Scenario 1: node_line_limit rejection → override → success
// ============================================================================

describe('Scenario 1: node_line_limit rejection → override → success', () => {
    const graph: Graph = mockGraph(['/vault/task.md'])
    const oversizedNode: CreateGraphNodeInput = mockNode({
        filename: 'big-progress',
        title: 'Progress',
        summary: linesOfText(80),
    })

    it('step 1: rejects oversized node with helpful error containing rule ID and override example', () => {
        const ctx: ValidationContext = buildCtx({
            nodes: [oversizedNode],
            resolvedParentNodeId: '/vault/task.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
            lineLimit: 70,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('violations')
        if (result.status !== 'violations') return

        const {unresolved} = resolveOverrides(result.violations, [])
        expect(unresolved.length).toBeGreaterThan(0)

        const errorMessage: string = formatViolationError(unresolved)
        expect(errorMessage).toContain('node_line_limit')
        expect(errorMessage).toContain('big-progress')
        expect(errorMessage).toContain('override_with_rationale')
        expect(errorMessage).toContain('"ruleId"')
    })

    it('step 2: succeeds when agent retries with override_with_rationale', () => {
        const ctx: ValidationContext = buildCtx({
            nodes: [oversizedNode],
            resolvedParentNodeId: '/vault/task.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
            lineLimit: 70,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('violations')
        if (result.status !== 'violations') return

        const {unresolved} = resolveOverrides(result.violations, [
            {ruleId: 'node_line_limit', rationale: 'This node contains a single indivisible code block'},
        ])
        expect(unresolved).toHaveLength(0)
    })
})

// ============================================================================
// Scenario 2: grandparent_attachment rejection → override → success
// ============================================================================

describe('Scenario 2: grandparent_attachment rejection → override → success', () => {
    const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
        ['/vault/task.md', ['/vault/project-root.md']],
    ])
    const graph: Graph = mockGraph(['/vault/task.md', '/vault/project-root.md'], incomingEdges)
    const normalNode: CreateGraphNodeInput = mockNode({
        filename: 'progress',
        title: 'Progress',
        summary: 'Short update',
    })

    it('step 1: rejects attachment to grandparent', () => {
        const ctx: ValidationContext = buildCtx({
            nodes: [normalNode],
            resolvedParentNodeId: '/vault/project-root.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('violations')
        if (result.status !== 'violations') return

        const {unresolved} = resolveOverrides(result.violations, [])
        expect(unresolved.length).toBeGreaterThan(0)
        expect(unresolved[0].ruleId).toBe('grandparent_attachment')
    })

    it('step 2: succeeds with override_with_rationale', () => {
        const ctx: ValidationContext = buildCtx({
            nodes: [normalNode],
            resolvedParentNodeId: '/vault/project-root.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('violations')
        if (result.status !== 'violations') return

        const {unresolved} = resolveOverrides(result.violations, [
            {ruleId: 'grandparent_attachment', rationale: 'Intentionally attaching to project root for visibility'},
        ])
        expect(unresolved).toHaveLength(0)
    })
})

// ============================================================================
// Scenario 3: Multiple violations, partial override
// ============================================================================

describe('Scenario 3: Multiple violations, partial override', () => {
    const incomingEdges: Map<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map([
        ['/vault/task.md', ['/vault/grandparent.md']],
    ])
    const graph: Graph = mockGraph(['/vault/task.md', '/vault/grandparent.md'], incomingEdges)
    const oversizedNode: CreateGraphNodeInput = mockNode({
        filename: 'big-node',
        title: 'T',
        summary: linesOfText(80),
    })

    it('still rejects when only one of two violations is overridden', () => {
        const ctx: ValidationContext = buildCtx({
            nodes: [oversizedNode],
            resolvedParentNodeId: '/vault/grandparent.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
            lineLimit: 70,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('violations')
        if (result.status !== 'violations') return

        // Verify BOTH violations present
        const ruleIds: ValidationRuleId[] = result.violations.map((v: RuleViolation) => v.ruleId)
        expect(ruleIds).toContain('grandparent_attachment')
        expect(ruleIds).toContain('node_line_limit')

        // Override only node_line_limit
        const {unresolved} = resolveOverrides(result.violations, [
            {ruleId: 'node_line_limit', rationale: 'Justified large node'},
        ])
        expect(unresolved).toHaveLength(1)
        expect(unresolved[0].ruleId).toBe('grandparent_attachment')

        // Error only shows the un-overridden rule
        const errorMessage: string = formatViolationError(unresolved)
        expect(errorMessage).toContain('grandparent_attachment')
        expect(errorMessage).not.toContain('node_line_limit')
    })

    it('succeeds when both violations are overridden', () => {
        const ctx: ValidationContext = buildCtx({
            nodes: [oversizedNode],
            resolvedParentNodeId: '/vault/grandparent.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
            lineLimit: 70,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('violations')
        if (result.status !== 'violations') return

        const {unresolved} = resolveOverrides(result.violations, [
            {ruleId: 'node_line_limit', rationale: 'Large code block'},
            {ruleId: 'grandparent_attachment', rationale: 'Project-level visibility'},
        ])
        expect(unresolved).toHaveLength(0)
    })
})

// ============================================================================
// Scenario 4: No violations, no override needed
// ============================================================================

describe('Scenario 4: No violations, no override needed', () => {
    it('succeeds with valid nodes and correct parent', () => {
        const graph: Graph = mockGraph(['/vault/task.md'])
        const ctx: ValidationContext = buildCtx({
            nodes: [
                mockNode({filename: 'progress-1', title: 'Research', summary: 'Found the bug'}),
                mockNode({filename: 'progress-2', title: 'Fix', summary: 'Applied patch'}),
            ],
            resolvedParentNodeId: '/vault/task.md',
            callerTaskNodeId: '/vault/task.md',
            graph,
            lineLimit: 70,
        })
        const result: ValidationResult = runValidations(ALL_RULES, ctx)
        expect(result.status).toBe('pass')
    })
})
