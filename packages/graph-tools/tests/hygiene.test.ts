import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
    checkMaxWikilinksPerNode,
    checkMaxTreeWidth,
    checkCanonicalHierarchy,
    runHygieneAudit,
    formatHygieneReportHuman,
    formatHygieneReportJson,
} from '../src/hygiene'
import { buildUniqueBasenameMap } from '../src/primitives'
import { buildFolderIndexMap } from '../src/lintContainment'
import type { StructureNode } from '../src/primitives'

let tempDir: string

beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'hygiene-test-'))
})

afterEach(() => {
    rmSync(tempDir, {recursive: true})
})

// --- Rule: max_wikilinks_per_node ---

describe('checkMaxWikilinksPerNode', () => {
    it('no violation when links at or below threshold', () => {
        const nodes = [
            {nodeId: 'a', content: '# A\n[[b]]\n[[c]]'},
        ]
        expect(checkMaxWikilinksPerNode(nodes, 3)).toEqual([])
    })

    it('violation when links exceed threshold', () => {
        const content = '# Dense\n' + Array.from({length: 6}, (_, i) => `[[node-${i}]]`).join('\n')
        const nodes = [{nodeId: 'dense', content}]
        const violations = checkMaxWikilinksPerNode(nodes, 5)
        expect(violations).toHaveLength(1)
        expect(violations[0]).toMatchObject({
            ruleId: 'max_wikilinks_per_node',
            severity: 'error',
            filePath: 'dense',
            actual: 6,
            threshold: 5,
        })
    })

    it('exactly at threshold is not a violation', () => {
        const content = '# Node\n' + Array.from({length: 5}, (_, i) => `[[n-${i}]]`).join('\n')
        const nodes = [{nodeId: 'x', content}]
        expect(checkMaxWikilinksPerNode(nodes, 5)).toEqual([])
    })
})

// --- Rule: max_tree_width ---

describe('checkMaxTreeWidth', () => {
    it('no violation when directory has fewer children than threshold', () => {
        writeFileSync(path.join(tempDir, 'a.md'), '# A')
        writeFileSync(path.join(tempDir, 'b.md'), '# B')
        const violations = checkMaxTreeWidth(tempDir, 5)
        expect(violations).toEqual([])
    })

    it('violation when directory exceeds threshold', () => {
        for (let i = 0; i < 6; i++) {
            writeFileSync(path.join(tempDir, `node-${i}.md`), `# Node ${i}`)
        }
        const violations = checkMaxTreeWidth(tempDir, 5)
        expect(violations).toHaveLength(1)
        expect(violations[0]).toMatchObject({
            ruleId: 'max_tree_width',
            severity: 'error',
            actual: 6,
            threshold: 5,
        })
    })

    it('counts subdirectories as children', () => {
        writeFileSync(path.join(tempDir, 'a.md'), '# A')
        mkdirSync(path.join(tempDir, 'sub'))
        writeFileSync(path.join(tempDir, 'sub', 'b.md'), '# B')
        // tempDir has 2 children (a.md + sub/) — below threshold of 3
        const violations = checkMaxTreeWidth(tempDir, 1)
        expect(violations.some(v => v.filePath === '.')).toBe(true)
    })
})

// --- Rule: canonical_hierarchy ---

describe('checkCanonicalHierarchy', () => {
    function makeMap(ids: string[]): Map<string, StructureNode> {
        return new Map(ids.map(id => [id, {id, title: '', outgoingIds: []}]))
    }

    it('no violation for node with correct filesystem parent', () => {
        const ids = ['sub/sub', 'sub/child']
        const nodesById = makeMap(ids)
        const folderIndexMap = buildFolderIndexMap(ids)
        const uniqueBasenames = buildUniqueBasenameMap(nodesById)
        const nodes = [
            {nodeId: 'sub/child', content: '# Child\n- parent [[sub]]'},
        ]
        const violations = checkCanonicalHierarchy(nodes, folderIndexMap, nodesById, uniqueBasenames)
        expect(violations.filter(v => v.severity === 'error')).toHaveLength(0)
    })

    it('error when parent link conflicts with filesystem parent', () => {
        const ids = ['sub/sub', 'sub/child', 'other/other', 'other/node']
        const nodesById = makeMap(ids)
        const folderIndexMap = buildFolderIndexMap(ids)
        const uniqueBasenames = buildUniqueBasenameMap(nodesById)
        // sub/child declares parent as other/other — which conflicts with sub/ as FS parent
        const nodes = [
            {nodeId: 'sub/child', content: '# Child\n- parent [[other]]'},
        ]
        const violations = checkCanonicalHierarchy(nodes, folderIndexMap, nodesById, uniqueBasenames)
        expect(violations.some(v => v.ruleId === 'canonical_hierarchy' && v.severity === 'error')).toBe(true)
    })

    it('warning for non-parent wikilink to unrelated folder-note', () => {
        const ids = ['alpha/alpha', 'alpha/page', 'beta/beta']
        const nodesById = makeMap(ids)
        const folderIndexMap = buildFolderIndexMap(ids)
        const uniqueBasenames = buildUniqueBasenameMap(nodesById)
        // alpha/page links to beta/beta (folder note of unrelated subtree)
        const nodes = [
            {nodeId: 'alpha/page', content: '# Page\n- parent [[alpha]]\n[[beta]]'},
        ]
        const violations = checkCanonicalHierarchy(nodes, folderIndexMap, nodesById, uniqueBasenames)
        expect(violations.some(v => v.ruleId === 'canonical_hierarchy' && v.severity === 'warning')).toBe(true)
    })
})

// --- runHygieneAudit integration ---

describe('runHygieneAudit', () => {
    it('clean vault — no violations, exit-worthy error count = 0', () => {
        writeFileSync(path.join(tempDir, 'root.md'), '# Root\n[[child]]')
        mkdirSync(path.join(tempDir, 'notes'))
        writeFileSync(path.join(tempDir, 'notes', 'child.md'), '# Child')
        const report = runHygieneAudit(tempDir, {thresholds: {maxWikilinksPerNode: 5, maxTreeWidth: 15}})
        expect(report.summary.totalErrors).toBe(0)
    })

    it('seeded violation: 30-wikilink node triggers max_wikilinks_per_node', () => {
        const links = Array.from({length: 30}, (_, i) => `[[target-${i}]]`).join('\n')
        writeFileSync(path.join(tempDir, 'dense.md'), `# Dense\n${links}`)
        const report = runHygieneAudit(tempDir, {
            rule: 'max_wikilinks_per_node',
            thresholds: {maxWikilinksPerNode: 5, maxTreeWidth: 15},
        })
        expect(report.summary.totalErrors).toBeGreaterThan(0)
        expect(report.violations[0]).toMatchObject({
            ruleId: 'max_wikilinks_per_node',
            severity: 'error',
            actual: 30,
        })
    })

    it('--rule filter limits to one rule only', () => {
        // Both rules would fire, but filter ensures only max_tree_width is checked
        for (let i = 0; i < 20; i++) {
            writeFileSync(path.join(tempDir, `f${i}.md`), `# F${i}\n[[a]]\n[[b]]\n[[c]]\n[[d]]\n[[e]]\n[[f]]`)
        }
        const report = runHygieneAudit(tempDir, {
            rule: 'max_tree_width',
            thresholds: {maxWikilinksPerNode: 5, maxTreeWidth: 10},
        })
        expect(report.violations.every(v => v.ruleId === 'max_tree_width')).toBe(true)
    })

    it('formatHygieneReportHuman includes violation message', () => {
        const links = Array.from({length: 10}, (_, i) => `[[t-${i}]]`).join('\n')
        writeFileSync(path.join(tempDir, 'big.md'), `# Big\n${links}`)
        const report = runHygieneAudit(tempDir, {
            rule: 'max_wikilinks_per_node',
            thresholds: {maxWikilinksPerNode: 5, maxTreeWidth: 15},
        })
        const human = formatHygieneReportHuman(report)
        expect(human).toContain('max_wikilinks_per_node')
        expect(human).toContain('10')
    })

    it('formatHygieneReportJson is valid JSON with violations array', () => {
        writeFileSync(path.join(tempDir, 'x.md'), '# X')
        const report = runHygieneAudit(tempDir)
        const json = formatHygieneReportJson(report)
        const parsed = JSON.parse(json)
        expect(Array.isArray(parsed.violations)).toBe(true)
        expect(typeof parsed.summary).toBe('object')
    })
})
