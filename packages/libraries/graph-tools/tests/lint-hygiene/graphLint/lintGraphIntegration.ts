import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync, readFileSync } from 'fs'
import path from 'path'
import {
    DEFAULT_LINT_CONFIG,
    formatLintReportHuman,
    formatLintReportJson,
    lintGraph,
    lintGraphWithFixes,
} from '../../../src/lint/graphLint'
import type {
    GraphLintReport,
    LintConfig,
    LintResult,
    NodeMetrics,
} from '../../../src/lint/graphLint'
import type { TempDirHandle } from './tempDirLifecycle'

const FIXTURE_ROOT = path.join(
    import.meta.dirname,
    '..',
    '..',
    'fixtures',
    'filesystem-graph-authoring'
)

export const describeLintGraphIntegration = (tempDir: TempDirHandle): void => {
    describe('lintGraph integration', () => {
        it('empty folder — returns empty report with zero counts', () => {
            const report: GraphLintReport = lintGraph(tempDir.get())
            expect(report.violations).toEqual([])
            expect(report.warnings).toEqual([])
            expect(report.summary.totalNodes).toBe(0)
            expect(report.summary.violationCount).toBe(0)
            expect(report.summary.warningCount).toBe(0)
        })

        it('simple tree — correct containment and zero violations', () => {
            writeFileSync(path.join(tempDir.get(), 'root.md'), '# Root\n[[child-a]]\n[[child-b]]')
            writeFileSync(path.join(tempDir.get(), 'child-a.md'), '# Child A\n- parent [[root]]')
            writeFileSync(path.join(tempDir.get(), 'child-b.md'), '# Child B\n- parent [[root]]')

            const report: GraphLintReport = lintGraph(tempDir.get())
            expect(report.summary.totalNodes).toBe(3)
            expect(report.violations).toEqual([])

            const rootMetrics: NodeMetrics | undefined = report.nodeMetrics.get('root')
            expect(rootMetrics).toBeDefined()
            expect(rootMetrics!.nChildren).toBe(2)
            expect(rootMetrics!.attentionItems).toBe(2)
        })

        it('parent edge detection from - parent [[X]] pattern', () => {
            writeFileSync(path.join(tempDir.get(), 'parent-node.md'), '# Parent')
            writeFileSync(path.join(tempDir.get(), 'child-node.md'), '# Child\n- parent [[parent-node]]')

            const report: GraphLintReport = lintGraph(tempDir.get())
            const parentMetrics: NodeMetrics | undefined = report.nodeMetrics.get('parent-node')
            expect(parentMetrics).toBeDefined()
            expect(parentMetrics!.nChildren).toBe(1)
        })

        it('folder hierarchy parent detection — canonical folder note is parent', () => {
            mkdirSync(path.join(tempDir.get(), 'topic'))
            writeFileSync(path.join(tempDir.get(), 'topic', 'topic.md'), '# Topic Folder')
            writeFileSync(path.join(tempDir.get(), 'topic', 'subtopic.md'), '# Subtopic')

            const report: GraphLintReport = lintGraph(tempDir.get())
            const topicMetrics: NodeMetrics | undefined = report.nodeMetrics.get('topic/topic')
            expect(topicMetrics).toBeDefined()
            expect(topicMetrics!.nChildren).toBe(1)
        })

        it('directory hierarchy contains nodes even without a folder note', () => {
            mkdirSync(path.join(tempDir.get(), 'topic'))
            writeFileSync(path.join(tempDir.get(), 'topic', 'subtopic.md'), '# Subtopic')

            const report: GraphLintReport = lintGraph(tempDir.get())

            expect(report.warnings.find(w => w.ruleId === 'ORPHAN' && w.nodeId === 'topic/subtopic')).toBeUndefined()
            expect(report.nodeMetrics.get('topic/subtopic')?.depth).toBe(1)
        })

        it('directory containment takes precedence over explicit parent edges', () => {
            mkdirSync(path.join(tempDir.get(), 'topic'))
            writeFileSync(path.join(tempDir.get(), 'topic', 'topic.md'), '# Topic Folder')
            writeFileSync(path.join(tempDir.get(), 'other.md'), '# Other')
            writeFileSync(path.join(tempDir.get(), 'topic', 'subtopic.md'), '# Subtopic\n- parent [[other]]')

            const report: GraphLintReport = lintGraph(tempDir.get())

            expect(report.nodeMetrics.get('topic/topic')?.nChildren).toBe(1)
            expect(report.nodeMetrics.get('other')?.nChildren).toBe(0)
        })

        it('folder note is excluded from child counts for its own folder', () => {
            mkdirSync(path.join(tempDir.get(), 'example'))
            writeFileSync(path.join(tempDir.get(), 'example', 'example.md'), '# Example Folder')
            writeFileSync(path.join(tempDir.get(), 'example', 'a.md'), '# A')
            writeFileSync(path.join(tempDir.get(), 'example', 'b.md'), '# B')

            const report: GraphLintReport = lintGraph(tempDir.get())
            const exampleMetrics: NodeMetrics | undefined = report.nodeMetrics.get('example/example')

            expect(exampleMetrics).toBeDefined()
            expect(exampleMetrics!.nChildren).toBe(2)
            expect(exampleMetrics!.attentionItems).toBe(2)
        })

        it('folder note without explicit parent edge does not trigger ORPHAN', () => {
            mkdirSync(path.join(tempDir.get(), 'example'))
            writeFileSync(path.join(tempDir.get(), 'example', 'example.md'), '# Example Folder')

            const report: GraphLintReport = lintGraph(tempDir.get())

            expect(report.warnings.find(w => w.ruleId === 'ORPHAN' && w.nodeId === 'example/example')).toBeUndefined()
        })

        it('OVERLOADED_NODE violation when n_children > 7', () => {
            writeFileSync(path.join(tempDir.get(), 'overloaded.md'), '# Overloaded')
            for (let i = 1; i <= 8; i++) {
                writeFileSync(
                    path.join(tempDir.get(), `child-${i}.md`),
                    `# Child ${i}\n- parent [[overloaded]]`
                )
            }

            const report: GraphLintReport = lintGraph(tempDir.get())
            expect(report.violations.length).toBeGreaterThanOrEqual(1)
            const overloadedViolation: LintResult | undefined = report.violations.find(
                v => v.ruleId === 'OVERLOADED_NODE' && v.nodeId === 'overloaded'
            )
            expect(overloadedViolation).toBeDefined()
            expect(overloadedViolation!.value).toBe(8)
            expect(overloadedViolation!.threshold).toBe(7)
        })

        it('ATTENTION_OVERFLOW violation when attention_items > 7', () => {
            writeFileSync(path.join(tempDir.get(), 'root.md'), '# Root')
            const childNames: string[] = ['a', 'b', 'c', 'd', 'e']
            for (const name of childNames) {
                const siblings: string[] = childNames.filter(n => n !== name)
                const siblingLinks: string = siblings.map(s => `[[${s}]]`).join('\n')
                writeFileSync(
                    path.join(tempDir.get(), `${name}.md`),
                    `# ${name}\n- parent [[root]]\n${siblingLinks}`
                )
            }

            const report: GraphLintReport = lintGraph(tempDir.get())
            const rootMetrics: NodeMetrics | undefined = report.nodeMetrics.get('root')
            expect(rootMetrics).toBeDefined()
            expect(rootMetrics!.attentionItems).toBeGreaterThan(7)

            const overflow: LintResult | undefined = report.violations.find(
                v => v.ruleId === 'ATTENTION_OVERFLOW' && v.nodeId === 'root'
            )
            expect(overflow).toBeDefined()
        })

        it('DUPLICATE_EDGE violation when same target linked twice', () => {
            writeFileSync(path.join(tempDir.get(), 'source.md'), '# Source\n[[target]]\nsome text\n[[target]]')
            writeFileSync(path.join(tempDir.get(), 'target.md'), '# Target')

            const report: GraphLintReport = lintGraph(tempDir.get())
            const dupeViolation: LintResult | undefined = report.violations.find(
                v => v.ruleId === 'DUPLICATE_EDGE' && v.nodeId === 'source'
            )
            expect(dupeViolation).toBeDefined()
        })

        it('HIGH_SIBLING_COUPLING warning when sibling_edge_density > 0.5', () => {
            writeFileSync(path.join(tempDir.get(), 'root.md'), '# Root')
            writeFileSync(path.join(tempDir.get(), 'x.md'), '# X\n- parent [[root]]\n[[y]]\n[[z]]')
            writeFileSync(path.join(tempDir.get(), 'y.md'), '# Y\n- parent [[root]]\n[[x]]\n[[z]]')
            writeFileSync(path.join(tempDir.get(), 'z.md'), '# Z\n- parent [[root]]\n[[x]]\n[[y]]')

            const report: GraphLintReport = lintGraph(tempDir.get())
            const coupling: LintResult | undefined = report.warnings.find(
                w => w.ruleId === 'HIGH_SIBLING_COUPLING' && w.nodeId === 'root'
            )
            expect(coupling).toBeDefined()
            expect(coupling!.value).toBe(1.0)
        })

        it('SINGLETON_COMPOUND warning when compound node has 1 child', () => {
            writeFileSync(path.join(tempDir.get(), 'wrapper.md'), '# Wrapper')
            writeFileSync(path.join(tempDir.get(), 'only-child.md'), '# Only Child\n- parent [[wrapper]]')

            const report: GraphLintReport = lintGraph(tempDir.get())
            const singleton: LintResult | undefined = report.warnings.find(
                w => w.ruleId === 'SINGLETON_COMPOUND' && w.nodeId === 'wrapper'
            )
            expect(singleton).toBeDefined()
        })

        it('ORPHAN warning for disconnected nodes', () => {
            writeFileSync(path.join(tempDir.get(), 'island.md'), '# Island')
            writeFileSync(path.join(tempDir.get(), 'connected.md'), '# Connected\n[[island]]')

            const report: GraphLintReport = lintGraph(tempDir.get())
            writeFileSync(path.join(tempDir.get(), 'loner.md'), '# Loner')
            const report2: GraphLintReport = lintGraph(tempDir.get())
            const orphan: LintResult | undefined = report2.warnings.find(
                w => w.ruleId === 'ORPHAN' && w.nodeId === 'loner'
            )
            expect(orphan).toBeDefined()
        })

        it('WIDE_CROSS_REF warning when n_cross_refs > 3', () => {
            writeFileSync(path.join(tempDir.get(), 'root.md'), '# Root')
            writeFileSync(
                path.join(tempDir.get(), 'linker.md'),
                '# Linker\n- parent [[root]]\n[[ext-1]]\n[[ext-2]]\n[[ext-3]]\n[[ext-4]]'
            )
            writeFileSync(path.join(tempDir.get(), 'ext-1.md'), '# Ext 1')
            writeFileSync(path.join(tempDir.get(), 'ext-2.md'), '# Ext 2')
            writeFileSync(path.join(tempDir.get(), 'ext-3.md'), '# Ext 3')
            writeFileSync(path.join(tempDir.get(), 'ext-4.md'), '# Ext 4')

            const report: GraphLintReport = lintGraph(tempDir.get())
            const wideCrossRef: LintResult | undefined = report.warnings.find(
                w => w.ruleId === 'WIDE_CROSS_REF' && w.nodeId === 'linker'
            )
            expect(wideCrossRef).toBeDefined()
            expect(wideCrossRef!.value).toBe(4)
        })

        it('configurable thresholds via LintConfig', () => {
            writeFileSync(path.join(tempDir.get(), 'root.md'), '# Root')
            for (let i = 1; i <= 4; i++) {
                writeFileSync(
                    path.join(tempDir.get(), `child-${i}.md`),
                    `# Child ${i}\n- parent [[root]]`
                )
            }

            const defaultReport: GraphLintReport = lintGraph(tempDir.get())
            expect(defaultReport.violations.filter(v => v.ruleId === 'OVERLOADED_NODE')).toEqual([])

            const strictConfig: LintConfig = { ...DEFAULT_LINT_CONFIG, maxArity: 3 }
            const strictReport: GraphLintReport = lintGraph(tempDir.get(), strictConfig)
            const violation: LintResult | undefined = strictReport.violations.find(
                v => v.ruleId === 'OVERLOADED_NODE' && v.nodeId === 'root'
            )
            expect(violation).toBeDefined()
            expect(violation!.threshold).toBe(3)
        })

        it('report summary contains correct aggregate metrics', () => {
            writeFileSync(path.join(tempDir.get(), 'root.md'), '# Root')
            writeFileSync(path.join(tempDir.get(), 'child.md'), '# Child\n- parent [[root]]')
            writeFileSync(path.join(tempDir.get(), 'grandchild.md'), '# Grandchild\n- parent [[child]]')

            const report: GraphLintReport = lintGraph(tempDir.get())
            expect(report.summary.totalNodes).toBe(3)
            expect(report.summary.maxDepth).toBe(2)
            expect(report.summary.maxAttentionItems).toBeGreaterThanOrEqual(1)
        })

        it('ctx-nodes folder excluded from lint', () => {
            writeFileSync(path.join(tempDir.get(), 'visible.md'), '# Visible')
            mkdirSync(path.join(tempDir.get(), 'ctx-nodes'))
            writeFileSync(path.join(tempDir.get(), 'ctx-nodes', 'hidden.md'), '# Hidden')

            const report: GraphLintReport = lintGraph(tempDir.get())
            expect(report.summary.totalNodes).toBe(1)
            expect(report.nodeMetrics.has('ctx-nodes/hidden')).toBe(false)
        })

        it('reports reusable authoring fixes and rejections in human and json output', () => {
            writeFileSync(path.join(tempDir.get(), 'root.md'), '# Root\n')
            writeFileSync(path.join(tempDir.get(), 'rough.md'), '# Rough\n- parent [root]   \n')
            writeFileSync(
                path.join(tempDir.get(), 'oversized.md'),
                readFileSync(path.join(FIXTURE_ROOT, 'rejectable', 'oversized-node', 'oversized-brief.md'), 'utf8')
            )

            const report: GraphLintReport = lintGraphWithFixes({
                folderPath: tempDir.get(),
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
            writeFileSync(path.join(tempDir.get(), 'root.md'), '# Root\n')
            writeFileSync(path.join(tempDir.get(), 'rough.md'), '# Rough\n- parent [root]   \n')

            const report: GraphLintReport = lintGraphWithFixes({
                folderPath: tempDir.get(),
                applyFixes: true,
                agentName: 'bf-127-lint-agent',
            })

            expect(report.authoring).toMatchObject({
                mode: 'fix',
                changedFiles: 2,
                rejectedFiles: 0,
            })
            const fixedMarkdown: string = readFileSync(path.join(tempDir.get(), 'rough.md'), 'utf8')
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
}
