import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
    lintGraph,
    buildContainmentTree,
    classifyEdges,
    computeNodeMetrics,
    checkRules,
    DEFAULT_LINT_CONFIG,
} from '@/shell/edge/main/graphLint'
import type {
    ContainmentTree,
    ClassifiedEdge,
    NodeMetrics,
    LintResult,
    GraphLintReport,
    LintConfig,
} from '@/shell/edge/main/graphLint'

let tempDir: string = ''

describe('graphLint', () => {

    beforeEach(() => {
        tempDir = mkdtempSync(path.join(tmpdir(), 'graph-lint-test-'))
    })

    afterEach(() => {
        rmSync(tempDir, { recursive: true })
    })

    describe('lintGraph integration', () => {

        it('empty folder — returns empty report with zero counts', () => {
            const report: GraphLintReport = lintGraph(tempDir)
            expect(report.violations).toEqual([])
            expect(report.warnings).toEqual([])
            expect(report.summary.totalNodes).toBe(0)
            expect(report.summary.violationCount).toBe(0)
            expect(report.summary.warningCount).toBe(0)
        })

        it('simple tree — correct containment and zero violations', () => {
            writeFileSync(path.join(tempDir, 'root.md'), '# Root\n[[child-a]]\n[[child-b]]')
            writeFileSync(path.join(tempDir, 'child-a.md'), '# Child A\n- parent [[root]]')
            writeFileSync(path.join(tempDir, 'child-b.md'), '# Child B\n- parent [[root]]')

            const report: GraphLintReport = lintGraph(tempDir)
            expect(report.summary.totalNodes).toBe(3)
            expect(report.violations).toEqual([])

            const rootMetrics: NodeMetrics | undefined = report.nodeMetrics.get('root')
            expect(rootMetrics).toBeDefined()
            expect(rootMetrics!.nChildren).toBe(2)
            expect(rootMetrics!.attentionItems).toBe(2) // 2 children, 0 sibling edges
        })

        it('parent edge detection from - parent [[X]] pattern', () => {
            writeFileSync(path.join(tempDir, 'parent-node.md'), '# Parent')
            writeFileSync(path.join(tempDir, 'child-node.md'), '# Child\n- parent [[parent-node]]')

            const report: GraphLintReport = lintGraph(tempDir)
            const parentMetrics: NodeMetrics | undefined = report.nodeMetrics.get('parent-node')
            expect(parentMetrics).toBeDefined()
            expect(parentMetrics!.nChildren).toBe(1)
        })

        it('folder hierarchy parent detection — index file is parent', () => {
            mkdirSync(path.join(tempDir, 'topic'))
            writeFileSync(path.join(tempDir, 'topic.md'), '# Topic Index')
            writeFileSync(path.join(tempDir, 'topic', 'subtopic.md'), '# Subtopic')

            const report: GraphLintReport = lintGraph(tempDir)
            const topicMetrics: NodeMetrics | undefined = report.nodeMetrics.get('topic')
            expect(topicMetrics).toBeDefined()
            expect(topicMetrics!.nChildren).toBe(1)
        })

        it('OVERLOADED_NODE violation when n_children > 7', () => {
            writeFileSync(path.join(tempDir, 'overloaded.md'), '# Overloaded')
            for (let i: number = 1; i <= 8; i++) {
                writeFileSync(
                    path.join(tempDir, `child-${i}.md`),
                    `# Child ${i}\n- parent [[overloaded]]`
                )
            }

            const report: GraphLintReport = lintGraph(tempDir)
            expect(report.violations.length).toBeGreaterThanOrEqual(1)
            const overloadedViolation: LintResult | undefined = report.violations.find(
                v => v.ruleId === 'OVERLOADED_NODE' && v.nodeId === 'overloaded'
            )
            expect(overloadedViolation).toBeDefined()
            expect(overloadedViolation!.value).toBe(8)
            expect(overloadedViolation!.threshold).toBe(7)
        })

        it('ATTENTION_OVERFLOW violation when attention_items > 7', () => {
            // 4 children with high sibling coupling (all link to each other)
            writeFileSync(path.join(tempDir, 'root.md'), '# Root')
            const childNames: string[] = ['a', 'b', 'c', 'd', 'e']
            for (const name of childNames) {
                const siblings: string[] = childNames.filter(n => n !== name)
                const siblingLinks: string = siblings.map(s => `[[${s}]]`).join('\n')
                writeFileSync(
                    path.join(tempDir, `${name}.md`),
                    `# ${name}\n- parent [[root]]\n${siblingLinks}`
                )
            }

            const report: GraphLintReport = lintGraph(tempDir)
            // 5 children + C(5,2)=10 sibling edges = 15 attention_items
            const rootMetrics: NodeMetrics | undefined = report.nodeMetrics.get('root')
            expect(rootMetrics).toBeDefined()
            expect(rootMetrics!.attentionItems).toBeGreaterThan(7)

            const overflow: LintResult | undefined = report.violations.find(
                v => v.ruleId === 'ATTENTION_OVERFLOW' && v.nodeId === 'root'
            )
            expect(overflow).toBeDefined()
        })

        it('DUPLICATE_EDGE violation when same target linked twice', () => {
            writeFileSync(path.join(tempDir, 'source.md'), '# Source\n[[target]]\nsome text\n[[target]]')
            writeFileSync(path.join(tempDir, 'target.md'), '# Target')

            const report: GraphLintReport = lintGraph(tempDir)
            const dupeViolation: LintResult | undefined = report.violations.find(
                v => v.ruleId === 'DUPLICATE_EDGE' && v.nodeId === 'source'
            )
            expect(dupeViolation).toBeDefined()
        })

        it('HIGH_SIBLING_COUPLING warning when sibling_edge_density > 0.5', () => {
            writeFileSync(path.join(tempDir, 'root.md'), '# Root')
            // 3 children, all linked to each other: density = 3/C(3,2) = 3/3 = 1.0
            writeFileSync(path.join(tempDir, 'x.md'), '# X\n- parent [[root]]\n[[y]]\n[[z]]')
            writeFileSync(path.join(tempDir, 'y.md'), '# Y\n- parent [[root]]\n[[x]]\n[[z]]')
            writeFileSync(path.join(tempDir, 'z.md'), '# Z\n- parent [[root]]\n[[x]]\n[[y]]')

            const report: GraphLintReport = lintGraph(tempDir)
            const coupling: LintResult | undefined = report.warnings.find(
                w => w.ruleId === 'HIGH_SIBLING_COUPLING' && w.nodeId === 'root'
            )
            expect(coupling).toBeDefined()
            expect(coupling!.value).toBe(1.0)
        })

        it('SINGLETON_COMPOUND warning when compound node has 1 child', () => {
            writeFileSync(path.join(tempDir, 'wrapper.md'), '# Wrapper')
            writeFileSync(path.join(tempDir, 'only-child.md'), '# Only Child\n- parent [[wrapper]]')

            const report: GraphLintReport = lintGraph(tempDir)
            const singleton: LintResult | undefined = report.warnings.find(
                w => w.ruleId === 'SINGLETON_COMPOUND' && w.nodeId === 'wrapper'
            )
            expect(singleton).toBeDefined()
        })

        it('ORPHAN warning for disconnected nodes', () => {
            writeFileSync(path.join(tempDir, 'island.md'), '# Island')
            writeFileSync(path.join(tempDir, 'connected.md'), '# Connected\n[[island]]')

            lintGraph(tempDir) // island has an incoming edge from connected, so it's not an orphan
            // But if we have a truly disconnected node:
            writeFileSync(path.join(tempDir, 'loner.md'), '# Loner')
            const report2: GraphLintReport = lintGraph(tempDir)
            const orphan: LintResult | undefined = report2.warnings.find(
                w => w.ruleId === 'ORPHAN' && w.nodeId === 'loner'
            )
            expect(orphan).toBeDefined()
        })

        it('WIDE_CROSS_REF warning when n_cross_refs > 3', () => {
            writeFileSync(path.join(tempDir, 'root.md'), '# Root')
            // Create a node with 4 cross-refs (not siblings, not parent)
            writeFileSync(
                path.join(tempDir, 'linker.md'),
                '# Linker\n- parent [[root]]\n[[ext-1]]\n[[ext-2]]\n[[ext-3]]\n[[ext-4]]'
            )
            writeFileSync(path.join(tempDir, 'ext-1.md'), '# Ext 1')
            writeFileSync(path.join(tempDir, 'ext-2.md'), '# Ext 2')
            writeFileSync(path.join(tempDir, 'ext-3.md'), '# Ext 3')
            writeFileSync(path.join(tempDir, 'ext-4.md'), '# Ext 4')

            const report: GraphLintReport = lintGraph(tempDir)
            const wideCrossRef: LintResult | undefined = report.warnings.find(
                w => w.ruleId === 'WIDE_CROSS_REF' && w.nodeId === 'linker'
            )
            expect(wideCrossRef).toBeDefined()
            expect(wideCrossRef!.value).toBe(4)
        })

        it('configurable thresholds via LintConfig', () => {
            writeFileSync(path.join(tempDir, 'root.md'), '# Root')
            for (let i: number = 1; i <= 4; i++) {
                writeFileSync(
                    path.join(tempDir, `child-${i}.md`),
                    `# Child ${i}\n- parent [[root]]`
                )
            }

            // Default max-arity is 7, so 4 children should pass
            const defaultReport: GraphLintReport = lintGraph(tempDir)
            expect(defaultReport.violations.filter(v => v.ruleId === 'OVERLOADED_NODE')).toEqual([])

            // With custom max-arity of 3, 4 children should violate
            const strictConfig: LintConfig = { ...DEFAULT_LINT_CONFIG, maxArity: 3 }
            const strictReport: GraphLintReport = lintGraph(tempDir, strictConfig)
            const violation: LintResult | undefined = strictReport.violations.find(
                v => v.ruleId === 'OVERLOADED_NODE' && v.nodeId === 'root'
            )
            expect(violation).toBeDefined()
            expect(violation!.threshold).toBe(3)
        })

        it('report summary contains correct aggregate metrics', () => {
            writeFileSync(path.join(tempDir, 'root.md'), '# Root')
            writeFileSync(path.join(tempDir, 'child.md'), '# Child\n- parent [[root]]')
            writeFileSync(path.join(tempDir, 'grandchild.md'), '# Grandchild\n- parent [[child]]')

            const report: GraphLintReport = lintGraph(tempDir)
            expect(report.summary.totalNodes).toBe(3)
            expect(report.summary.maxDepth).toBe(2) // root=0, child=1, grandchild=2
            expect(report.summary.maxAttentionItems).toBeGreaterThanOrEqual(1)
        })

        it('ctx-nodes folder excluded from lint', () => {
            writeFileSync(path.join(tempDir, 'visible.md'), '# Visible')
            mkdirSync(path.join(tempDir, 'ctx-nodes'))
            writeFileSync(path.join(tempDir, 'ctx-nodes', 'hidden.md'), '# Hidden')

            const report: GraphLintReport = lintGraph(tempDir)
            expect(report.summary.totalNodes).toBe(1)
            expect(report.nodeMetrics.has('ctx-nodes/hidden')).toBe(false)
        })
    })

    describe('buildContainmentTree', () => {

        it('builds parent-child from explicit parent edges', () => {
            const nodeContents: Map<string, string> = new Map([
                ['root', '# Root'],
                ['child', '# Child\n- parent [[root]]'],
            ])
            const nodeIds: string[] = ['root', 'child']

            const tree: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, new Map())
            expect(tree.parentOf.get('child')).toBe('root')
            expect(tree.childrenOf.get('root')).toEqual(['child'])
        })

        it('builds parent-child from folder hierarchy', () => {
            const nodeContents: Map<string, string> = new Map([
                ['topic', '# Topic'],
                ['topic/subtopic', '# Subtopic'],
            ])
            const nodeIds: string[] = ['topic', 'topic/subtopic']
            const folderIndexMap: Map<string, string> = new Map([
                ['topic', 'topic'],
            ])

            const tree: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, folderIndexMap)
            expect(tree.parentOf.get('topic/subtopic')).toBe('topic')
        })

        it('explicit parent overrides folder hierarchy', () => {
            const nodeContents: Map<string, string> = new Map([
                ['topic', '# Topic'],
                ['topic/subtopic', '# Subtopic\n- parent [[other]]'],
                ['other', '# Other'],
            ])
            const nodeIds: string[] = ['topic', 'topic/subtopic', 'other']
            const folderIndexMap: Map<string, string> = new Map([
                ['topic', 'topic'],
            ])

            const tree: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, folderIndexMap)
            expect(tree.parentOf.get('topic/subtopic')).toBe('other')
        })
    })

    describe('classifyEdges', () => {

        it('classifies parent, sibling, and cross-ref edges', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([
                    ['child-a', 'root'],
                    ['child-b', 'root'],
                    ['root', null],
                ]),
                childrenOf: new Map([
                    ['root', ['child-a', 'child-b']],
                ]),
            }

            // child-a links to root (parent) and child-b (sibling), and ext (cross-ref)
            const allLinks: Map<string, string[]> = new Map([
                ['child-a', ['root', 'child-b', 'ext']],
            ])

            const edges: ClassifiedEdge[] = classifyEdges(allLinks, tree)

            const parentEdge: ClassifiedEdge | undefined = edges.find(
                e => e.source === 'child-a' && e.target === 'root'
            )
            expect(parentEdge?.type).toBe('parent')

            const siblingEdge: ClassifiedEdge | undefined = edges.find(
                e => e.source === 'child-a' && e.target === 'child-b'
            )
            expect(siblingEdge?.type).toBe('sibling')

            const crossRef: ClassifiedEdge | undefined = edges.find(
                e => e.source === 'child-a' && e.target === 'ext'
            )
            expect(crossRef?.type).toBe('cross_ref')
        })
    })

    describe('computeNodeMetrics', () => {

        it('computes metrics correctly for a node with children and sibling edges', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([
                    ['root', null],
                    ['a', 'root'],
                    ['b', 'root'],
                    ['c', 'root'],
                ]),
                childrenOf: new Map([
                    ['root', ['a', 'b', 'c']],
                ]),
            }
            // a-b and b-c are sibling edges (2 undirected edges)
            const edges: ClassifiedEdge[] = [
                { source: 'a', target: 'b', type: 'sibling' },
                { source: 'b', target: 'c', type: 'sibling' },
            ]

            const metrics: NodeMetrics = computeNodeMetrics('root', tree, edges, DEFAULT_LINT_CONFIG)
            expect(metrics.nChildren).toBe(3)
            expect(metrics.nSiblingEdges).toBe(2)
            expect(metrics.attentionItems).toBe(5) // 3 + 2
            expect(metrics.siblingEdgeDensity).toBeCloseTo(2 / 3) // 2 / C(3,2)=3
            expect(metrics.depth).toBe(0) // root
        })

        it('computes depth from parent chain', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([
                    ['root', null],
                    ['mid', 'root'],
                    ['leaf', 'mid'],
                ]),
                childrenOf: new Map([
                    ['root', ['mid']],
                    ['mid', ['leaf']],
                ]),
            }
            const edges: ClassifiedEdge[] = []

            expect(computeNodeMetrics('root', tree, edges, DEFAULT_LINT_CONFIG).depth).toBe(0)
            expect(computeNodeMetrics('mid', tree, edges, DEFAULT_LINT_CONFIG).depth).toBe(1)
            expect(computeNodeMetrics('leaf', tree, edges, DEFAULT_LINT_CONFIG).depth).toBe(2)
        })

        it('node_cost scales with dependency_scaling', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([
                    ['root', null],
                    ['a', 'root'],
                    ['b', 'root'],
                ]),
                childrenOf: new Map([
                    ['root', ['a', 'b']],
                ]),
            }
            // No sibling edges: density=0 → scaling=1.0 → cost = 2*1 = 2
            const noEdges: ClassifiedEdge[] = []
            const lowMetrics: NodeMetrics = computeNodeMetrics('root', tree, noEdges, DEFAULT_LINT_CONFIG)
            expect(lowMetrics.nodeCost).toBe(2) // attention_items=2, scaling=1.0

            // With sibling edge: density=1/C(2,2)=1/1=1.0 → scaling = attention_items²
            // attention_items=2+1=3, cost = 3 * 3² = 27
            const fullEdges: ClassifiedEdge[] = [
                { source: 'a', target: 'b', type: 'sibling' },
            ]
            const highMetrics: NodeMetrics = computeNodeMetrics('root', tree, fullEdges, DEFAULT_LINT_CONFIG)
            expect(highMetrics.siblingEdgeDensity).toBe(1.0)
            expect(highMetrics.nodeCost).toBeGreaterThan(lowMetrics.nodeCost)
        })
    })

    describe('checkRules', () => {

        it('OVERLOADED_NODE fires at threshold', () => {
            const metrics: NodeMetrics = {
                nChildren: 8,
                nSiblingEdges: 0,
                attentionItems: 8,
                siblingEdgeDensity: 0,
                depth: 0,
                nCrossRefs: 0,
                nodeCost: 8,
            }

            const results: LintResult[] = checkRules('test-node', metrics, DEFAULT_LINT_CONFIG, 10)
            const violation: LintResult | undefined = results.find(r => r.ruleId === 'OVERLOADED_NODE')
            expect(violation).toBeDefined()
            expect(violation!.severity).toBe('violation')
        })

        it('no OVERLOADED_NODE when at exactly 7', () => {
            const metrics: NodeMetrics = {
                nChildren: 7,
                nSiblingEdges: 0,
                attentionItems: 7,
                siblingEdgeDensity: 0,
                depth: 0,
                nCrossRefs: 0,
                nodeCost: 7,
            }

            const results: LintResult[] = checkRules('test-node', metrics, DEFAULT_LINT_CONFIG, 10)
            const violation: LintResult | undefined = results.find(r => r.ruleId === 'OVERLOADED_NODE')
            expect(violation).toBeUndefined()
        })

        it('DEEP_CHAIN fires when depth exceeds formula', () => {
            // With 10 total nodes, mean branching ~3, depth threshold ≈ 2*ceil(log3(10)) ≈ 2*3=6
            const metrics: NodeMetrics = {
                nChildren: 0,
                nSiblingEdges: 0,
                attentionItems: 0,
                siblingEdgeDensity: 0,
                depth: 7,
                nCrossRefs: 0,
                nodeCost: 0,
            }

            const results: LintResult[] = checkRules('deep-node', metrics, DEFAULT_LINT_CONFIG, 10)
            const warning: LintResult | undefined = results.find(r => r.ruleId === 'DEEP_CHAIN')
            expect(warning).toBeDefined()
            expect(warning!.severity).toBe('warning')
        })
    })
})
