import { describe, it, expect } from 'vitest'
import { checkRules, DEFAULT_LINT_CONFIG } from '../../../src/lint/graphLint'
import type { LintResult, NodeMetrics } from '../../../src/lint/graphLint'

export const describeCheckRules = (): void => {
    describe('checkRules', () => {
        it('OVERLOADED_NODE fires at threshold', () => {
            const metrics: NodeMetrics = {
                nChildren: 8, nSiblingEdges: 0, attentionItems: 8,
                siblingEdgeDensity: 0, depth: 0, nCrossRefs: 0, nodeCost: 8,
            }
            const results: LintResult[] = checkRules('test-node', metrics, DEFAULT_LINT_CONFIG, 10)
            const violation: LintResult | undefined = results.find(r => r.ruleId === 'OVERLOADED_NODE')
            expect(violation).toBeDefined()
            expect(violation!.severity).toBe('violation')
        })

        it('no OVERLOADED_NODE when at exactly 7', () => {
            const metrics: NodeMetrics = {
                nChildren: 7, nSiblingEdges: 0, attentionItems: 7,
                siblingEdgeDensity: 0, depth: 0, nCrossRefs: 0, nodeCost: 7,
            }
            const results: LintResult[] = checkRules('test-node', metrics, DEFAULT_LINT_CONFIG, 10)
            expect(results.find(r => r.ruleId === 'OVERLOADED_NODE')).toBeUndefined()
        })

        it('DEEP_CHAIN fires when depth exceeds formula', () => {
            const metrics: NodeMetrics = {
                nChildren: 0, nSiblingEdges: 0, attentionItems: 0,
                siblingEdgeDensity: 0, depth: 7, nCrossRefs: 0, nodeCost: 0,
            }
            const results: LintResult[] = checkRules('deep-node', metrics, DEFAULT_LINT_CONFIG, 10)
            const warning: LintResult | undefined = results.find(r => r.ruleId === 'DEEP_CHAIN')
            expect(warning).toBeDefined()
            expect(warning!.severity).toBe('warning')
        })
    })
}
