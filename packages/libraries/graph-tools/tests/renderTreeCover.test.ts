import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {buildAutoViewGraph, renderTreeCover, renderAutoView} from '../src/view/autoView'

describe('renderTreeCover', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const tempDir of tempDirs) {
            rmSync(tempDir, {recursive: true, force: true})
        }
        tempDirs.length = 0
    })

    function makeFixtureVault(): string {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-render-tree-cover-'))
        tempDirs.push(tempDir)

        mkdirSync(path.join(tempDir, 'notes'))
        mkdirSync(path.join(tempDir, 'tasks'))
        writeFileSync(path.join(tempDir, 'root.md'), '# Root\n\n[[notes/summary]]\n[[tasks/task-1]]\n')
        writeFileSync(path.join(tempDir, 'notes', 'summary.md'), '# Summary\n\n[[notes/detail]]\n')
        writeFileSync(path.join(tempDir, 'notes', 'detail.md'), '# Detail\n\n[[notes/summary]]\n')
        writeFileSync(path.join(tempDir, 'tasks', 'task-1.md'), '# Task 1\n\n[[tasks/task-2]]\n[[root]]\n')
        writeFileSync(path.join(tempDir, 'tasks', 'task-2.md'), '# Task 2\n\n[[tasks/task-3]]\n[[tasks/task-1]]\n')
        writeFileSync(path.join(tempDir, 'tasks', 'task-3.md'), '# Task 3\n\n[[tasks/task-2]]\n')

        return tempDir
    }

    function makeLargeFixtureVault(): string {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-render-tree-cover-large-'))
        tempDirs.push(tempDir)

        mkdirSync(path.join(tempDir, 'docs'))
        mkdirSync(path.join(tempDir, 'src'))
        mkdirSync(path.join(tempDir, 'src', 'components'))
        writeFileSync(path.join(tempDir, 'index.md'), '# Index\n\n[[docs/intro]]\n[[src/main]]\n')
        writeFileSync(path.join(tempDir, 'docs', 'intro.md'), '# Intro\n\n[[docs/guide]]\n')
        writeFileSync(path.join(tempDir, 'docs', 'guide.md'), '# Guide\n\n[[docs/intro]]\n[[src/main]]\n')
        writeFileSync(path.join(tempDir, 'src', 'main.md'), '# Main\n\n[[src/components/button]]\n[[src/components/modal]]\n')
        writeFileSync(path.join(tempDir, 'src', 'components', 'button.md'), '# Button\n\n[[src/main]]\n')
        writeFileSync(path.join(tempDir, 'src', 'components', 'modal.md'), '# Modal\n\n[[src/components/button]]\n')

        return tempDir
    }

    it('produces identical output to renderAutoView for uncollapsed vault', () => {
        const vaultPath = makeFixtureVault()
        const root = path.resolve(vaultPath)
        const graph = buildAutoViewGraph(root)
        const fromPure = renderTreeCover(graph, {budget: 1000})
        const fromLegacy = renderAutoView(vaultPath, {budget: 1000}).output
        expect(fromPure).toBe(fromLegacy)
    })

    it('produces identical output to renderAutoView for collapsed vault', () => {
        const vaultPath = makeFixtureVault()
        const root = path.resolve(vaultPath)
        const graph = buildAutoViewGraph(root)
        const fromPure = renderTreeCover(graph, {budget: 3})
        const fromLegacy = renderAutoView(vaultPath, {budget: 3}).output
        expect(fromPure).toBe(fromLegacy)
    })

    it('produces identical output for larger vault with nested folders', () => {
        const vaultPath = makeLargeFixtureVault()
        const root = path.resolve(vaultPath)
        const graph = buildAutoViewGraph(root)
        const fromPure = renderTreeCover(graph, {budget: 1000})
        const fromLegacy = renderAutoView(vaultPath, {budget: 1000}).output
        expect(fromPure).toBe(fromLegacy)
    })

    it('returns empty string for empty graph', () => {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-render-tree-cover-empty-'))
        tempDirs.push(tempDir)
        const graph = buildAutoViewGraph(path.resolve(tempDir))
        expect(renderTreeCover(graph)).toBe('')
    })

    it('is a pure function: same graph + opts produces same output', () => {
        const vaultPath = makeFixtureVault()
        const root = path.resolve(vaultPath)
        const graph = buildAutoViewGraph(root)
        const opts = {budget: 3}
        const first = renderTreeCover(graph, opts)
        const second = renderTreeCover(graph, opts)
        expect(first).toBe(second)
    })

    it('accepts selected as ReadonlySet and matches selectedIds behavior', () => {
        const vaultPath = makeFixtureVault()
        const root = path.resolve(vaultPath)
        const graph = buildAutoViewGraph(root)
        const nodeId = graph.nodes[0]!.id
        const fromSet = renderTreeCover(graph, {budget: 3, selected: new Set([nodeId])})
        const fromLegacy = renderAutoView(vaultPath, {budget: 3, selectedIds: [nodeId]}).output
        expect(fromSet).toBe(fromLegacy)
    })

    it('snapshot: uncollapsed small vault', () => {
        const vaultPath = makeFixtureVault()
        const root = path.resolve(vaultPath)
        const graph = buildAutoViewGraph(root)
        const output = renderTreeCover(graph, {budget: 1000})
        expect(output).toContain('# format: tree-cover (auto-selected)')
        expect(output).toContain('═══ SPINE (folder hierarchy, no content edges) ═══')
        expect(output).toContain('═══ COVER FOREST')
        expect(output).not.toContain('[collapsed:')
    })

    it('snapshot: collapsed small vault', () => {
        const vaultPath = makeFixtureVault()
        const root = path.resolve(vaultPath)
        const graph = buildAutoViewGraph(root)
        const output = renderTreeCover(graph, {budget: 3})
        expect(output).toContain('# budget: 3 visible entities')
        expect(output).toContain('[collapsed:')
        expect(output).toContain('# hint: to expand a collapsed')
    })
})
