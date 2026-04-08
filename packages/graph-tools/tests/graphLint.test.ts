import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
    lintGraph,
    lintGraphWithFixes,
    buildContainmentTree,
    classifyEdges,
    computeNodeMetrics,
    checkRules,
    DEFAULT_LINT_CONFIG,
    formatLintReportHuman,
    formatLintReportJson,
} from '../src/graphLint'
import type {
    ContainmentTree,
    ClassifiedEdge,
    NodeMetrics,
    LintResult,
    GraphLintReport,
    LintConfig,
} from '../src/graphLint'

const FIXTURE_ROOT = path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'filesystem-graph-authoring'
)

// eslint-disable-next-line functional/no-let
let tempDir: string

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
            expect(rootMetrics!.attentionItems).toBe(2)
        })

        it('parent edge detection from - parent [[X]] pattern', () => {
            writeFileSync(path.join(tempDir, 'parent-node.md'), '# Parent')
            writeFileSync(path.join(tempDir, 'child-node.md'), '# Child\n- parent [[parent-node]]')

            const report: GraphLintReport = lintGraph(tempDir)
            const parentMetrics: NodeMetrics | undefined = report.nodeMetrics.get('parent-node')
            expect(parentMetrics).toBeDefined()
            expect(parentMetrics!.nChildren).toBe(1)
        })

        it('folder hierarchy parent detection — canonical folder note is parent', () => {
            mkdirSync(path.join(tempDir, 'topic'))
            writeFileSync(path.join(tempDir, 'topic', 'topic.md'), '# Topic Folder')
            writeFileSync(path.join(tempDir, 'topic', 'subtopic.md'), '# Subtopic')

            const report: GraphLintReport = lintGraph(tempDir)
            const topicMetrics: NodeMetrics | undefined = report.nodeMetrics.get('topic/topic')
            expect(topicMetrics).toBeDefined()
            expect(topicMetrics!.nChildren).toBe(1)
        })

        it('directory hierarchy contains nodes even without a folder note', () => {
            mkdirSync(path.join(tempDir, 'topic'))
            writeFileSync(path.join(tempDir, 'topic', 'subtopic.md'), '# Subtopic')

            const report: GraphLintReport = lintGraph(tempDir)

            expect(report.warnings.find(w => w.ruleId === 'ORPHAN' && w.nodeId === 'topic/subtopic')).toBeUndefined()
            expect(report.nodeMetrics.get('topic/subtopic')?.depth).toBe(1)
        })

        it('directory containment takes precedence over explicit parent edges', () => {
            mkdirSync(path.join(tempDir, 'topic'))
            writeFileSync(path.join(tempDir, 'topic', 'topic.md'), '# Topic Folder')
            writeFileSync(path.join(tempDir, 'other.md'), '# Other')
            writeFileSync(path.join(tempDir, 'topic', 'subtopic.md'), '# Subtopic\n- parent [[other]]')

            const report: GraphLintReport = lintGraph(tempDir)

            expect(report.nodeMetrics.get('topic/topic')?.nChildren).toBe(1)
            expect(report.nodeMetrics.get('other')?.nChildren).toBe(0)
        })

        it('folder note is excluded from child counts for its own folder', () => {
            mkdirSync(path.join(tempDir, 'example'))
            writeFileSync(path.join(tempDir, 'example', 'example.md'), '# Example Folder')
            writeFileSync(path.join(tempDir, 'example', 'a.md'), '# A')
            writeFileSync(path.join(tempDir, 'example', 'b.md'), '# B')

            const report: GraphLintReport = lintGraph(tempDir)
            const exampleMetrics: NodeMetrics | undefined = report.nodeMetrics.get('example/example')

            expect(exampleMetrics).toBeDefined()
            expect(exampleMetrics!.nChildren).toBe(2)
            expect(exampleMetrics!.attentionItems).toBe(2)
        })

        it('folder note without explicit parent edge does not trigger ORPHAN', () => {
            mkdirSync(path.join(tempDir, 'example'))
            writeFileSync(path.join(tempDir, 'example', 'example.md'), '# Example Folder')

            const report: GraphLintReport = lintGraph(tempDir)

            expect(report.warnings.find(w => w.ruleId === 'ORPHAN' && w.nodeId === 'example/example')).toBeUndefined()
        })

        it('OVERLOADED_NODE violation when n_children > 7', () => {
            writeFileSync(path.join(tempDir, 'overloaded.md'), '# Overloaded')
            for (let i = 1; i <= 8; i++) {
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

            const report: GraphLintReport = lintGraph(tempDir)
            writeFileSync(path.join(tempDir, 'loner.md'), '# Loner')
            const report2: GraphLintReport = lintGraph(tempDir)
            const orphan: LintResult | undefined = report2.warnings.find(
                w => w.ruleId === 'ORPHAN' && w.nodeId === 'loner'
            )
            expect(orphan).toBeDefined()
        })

        it('WIDE_CROSS_REF warning when n_cross_refs > 3', () => {
            writeFileSync(path.join(tempDir, 'root.md'), '# Root')
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
            for (let i = 1; i <= 4; i++) {
                writeFileSync(
                    path.join(tempDir, `child-${i}.md`),
                    `# Child ${i}\n- parent [[root]]`
                )
            }

            const defaultReport: GraphLintReport = lintGraph(tempDir)
            expect(defaultReport.violations.filter(v => v.ruleId === 'OVERLOADED_NODE')).toEqual([])

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
            expect(report.summary.maxDepth).toBe(2)
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

        it('reports reusable authoring fixes and rejections in human and json output', () => {
            writeFileSync(path.join(tempDir, 'root.md'), '# Root\n')
            writeFileSync(path.join(tempDir, 'rough.md'), '# Rough\n- parent [root]   \n')
            writeFileSync(
                path.join(tempDir, 'oversized.md'),
                readFileSync(path.join(FIXTURE_ROOT, 'rejectable', 'oversized-node', 'oversized-brief.md'), 'utf8')
            )

            const report: GraphLintReport = lintGraphWithFixes({
                folderPath: tempDir,
                agentName: 'bf-127-lint-agent',
            })

            expect(report.authoring).toMatchObject({
                mode: 'check',
                changedFiles: 0,
                rejectedFiles: 1,
            })
            expect(report.authoring?.entries).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    filename: 'rough.md',
                    applied: false,
                    fixes: expect.arrayContaining([
                        expect.objectContaining({code: 'converted_structural_soft_links'}),
                        expect.objectContaining({code: 'trimmed_trailing_whitespace'}),
                        expect.objectContaining({code: 'added_frontmatter'}),
                    ]),
                    rejections: [],
                }),
                expect.objectContaining({
                    filename: 'oversized.md',
                    rejections: expect.arrayContaining([
                        expect.objectContaining({
                            code: 'node_too_long',
                            suggestions: expect.arrayContaining([
                                expect.stringContaining('Evidence'),
                            ]),
                        }),
                    ]),
                }),
            ]))

            const humanOutput: string = formatLintReportHuman(report)
            expect(humanOutput).toContain('AUTHORING CHECK')
            expect(humanOutput).toContain('rough.md')
            expect(humanOutput).toContain('would fix')
            expect(humanOutput).toContain('oversized.md REJECTED')

            const jsonOutput = JSON.parse(formatLintReportJson(report))
            expect(jsonOutput.authoring.mode).toBe('check')
            expect(jsonOutput.authoring.entries).toEqual(expect.arrayContaining([
                expect.objectContaining({filename: 'rough.md', applied: false}),
                expect.objectContaining({filename: 'oversized.md'}),
            ]))
        })

        it('applies the reusable authoring fix layer when lint --fix is enabled', () => {
            writeFileSync(path.join(tempDir, 'root.md'), '# Root\n')
            writeFileSync(path.join(tempDir, 'rough.md'), '# Rough\n- parent [root]   \n')

            const report: GraphLintReport = lintGraphWithFixes({
                folderPath: tempDir,
                applyFixes: true,
                agentName: 'bf-127-lint-agent',
            })

            expect(report.authoring).toMatchObject({
                mode: 'fix',
                changedFiles: 2,
                rejectedFiles: 0,
            })
            const fixedMarkdown: string = readFileSync(path.join(tempDir, 'rough.md'), 'utf8')
            expect(fixedMarkdown).toContain('color: blue')
            expect(fixedMarkdown).toContain('agent_name: bf-127-lint-agent')
            expect(fixedMarkdown).toContain('isContextNode: false')
            expect(fixedMarkdown).toContain('- parent [[root]]')
            expect(fixedMarkdown).not.toContain('- parent [root]')
            expect(fixedMarkdown).not.toContain('   \n')
            expect(report.authoring?.entries.find(entry => entry.filename === 'rough.md')).toMatchObject({
                applied: true,
            })
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

        it('builds parent-child from canonical folder note hierarchy', () => {
            const nodeContents: Map<string, string> = new Map([
                ['topic/topic', '# Topic'],
                ['topic/subtopic', '# Subtopic'],
            ])
            const nodeIds: string[] = ['topic/topic', 'topic/subtopic']
            const folderIndexMap: Map<string, string> = new Map([['topic', 'topic/topic']])

            const tree: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, folderIndexMap)
            expect(tree.parentOf.get('topic/subtopic')).toBe('topic/topic')
        })

        it('builds parent-child from directory hierarchy without a folder note', () => {
            const nodeContents: Map<string, string> = new Map([
                ['topic/subtopic', '# Subtopic'],
            ])
            const nodeIds: string[] = ['topic/subtopic']

            const tree: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, new Map())
            const parentId: string | null | undefined = tree.parentOf.get('topic/subtopic')

            expect(parentId).toBeTruthy()
            expect(tree.childrenOf.get(parentId!) ?? []).toContain('topic/subtopic')
        })

        it('directory containment overrides explicit parent edges', () => {
            const nodeContents: Map<string, string> = new Map([
                ['topic/topic', '# Topic'],
                ['topic/subtopic', '# Subtopic\n- parent [[other]]'],
                ['other', '# Other'],
            ])
            const nodeIds: string[] = ['topic/topic', 'topic/subtopic', 'other']
            const folderIndexMap: Map<string, string> = new Map([['topic', 'topic/topic']])

            const tree: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, folderIndexMap)
            expect(tree.parentOf.get('topic/subtopic')).toBe('topic/topic')
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

            const allLinks: Map<string, string[]> = new Map([
                ['child-a', ['root', 'child-b', 'ext']],
            ])

            const edges: ClassifiedEdge[] = classifyEdges(allLinks, tree)

            expect(edges.find(e => e.source === 'child-a' && e.target === 'root')?.type).toBe('parent')
            expect(edges.find(e => e.source === 'child-a' && e.target === 'child-b')?.type).toBe('sibling')
            expect(edges.find(e => e.source === 'child-a' && e.target === 'ext')?.type).toBe('cross_ref')
        })
    })

    describe('computeNodeMetrics', () => {

        it('computes metrics correctly for a node with children and sibling edges', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([['root', null], ['a', 'root'], ['b', 'root'], ['c', 'root']]),
                childrenOf: new Map([['root', ['a', 'b', 'c']]]),
            }
            const edges: ClassifiedEdge[] = [
                { source: 'a', target: 'b', type: 'sibling' },
                { source: 'b', target: 'c', type: 'sibling' },
            ]

            const metrics: NodeMetrics = computeNodeMetrics('root', tree, edges, DEFAULT_LINT_CONFIG)
            expect(metrics.nChildren).toBe(3)
            expect(metrics.nSiblingEdges).toBe(2)
            expect(metrics.attentionItems).toBe(5)
            expect(metrics.siblingEdgeDensity).toBeCloseTo(2 / 3)
            expect(metrics.depth).toBe(0)
        })

        it('computes depth from parent chain', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([['root', null], ['mid', 'root'], ['leaf', 'mid']]),
                childrenOf: new Map([['root', ['mid']], ['mid', ['leaf']]]),
            }
            const edges: ClassifiedEdge[] = []

            expect(computeNodeMetrics('root', tree, edges, DEFAULT_LINT_CONFIG).depth).toBe(0)
            expect(computeNodeMetrics('mid', tree, edges, DEFAULT_LINT_CONFIG).depth).toBe(1)
            expect(computeNodeMetrics('leaf', tree, edges, DEFAULT_LINT_CONFIG).depth).toBe(2)
        })

        it('node_cost scales with dependency_scaling', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([['root', null], ['a', 'root'], ['b', 'root']]),
                childrenOf: new Map([['root', ['a', 'b']]]),
            }
            const noEdges: ClassifiedEdge[] = []
            const lowMetrics: NodeMetrics = computeNodeMetrics('root', tree, noEdges, DEFAULT_LINT_CONFIG)
            expect(lowMetrics.nodeCost).toBe(2)

            const fullEdges: ClassifiedEdge[] = [{ source: 'a', target: 'b', type: 'sibling' }]
            const highMetrics: NodeMetrics = computeNodeMetrics('root', tree, fullEdges, DEFAULT_LINT_CONFIG)
            expect(highMetrics.siblingEdgeDensity).toBe(1.0)
            expect(highMetrics.nodeCost).toBeGreaterThan(lowMetrics.nodeCost)
        })
    })

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
})
