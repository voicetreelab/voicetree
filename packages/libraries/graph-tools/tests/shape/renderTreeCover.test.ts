import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {buildAutoViewGraph, renderTreeCover, renderAutoView} from '../../src/view/autoView'

describe('renderTreeCover', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const tempDir of tempDirs) {
            rmSync(tempDir, {recursive: true, force: true})
        }
        tempDirs.length = 0
    })

    function makeFixtureProject(): string {
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

    function makeLargeFixtureProject(): string {
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

    it('produces identical output to renderAutoView for uncollapsed project', () => {
        const projectPath = makeFixtureProject()
        const root = path.resolve(projectPath)
        const graph = buildAutoViewGraph(root)
        const fromPure = renderTreeCover(graph, {budget: 1000})
        const fromLegacy = renderAutoView(projectPath, {budget: 1000}).output
        expect(fromPure).toBe(fromLegacy)
    })

    it('produces identical output to renderAutoView for collapsed project', () => {
        const projectPath = makeFixtureProject()
        const root = path.resolve(projectPath)
        const graph = buildAutoViewGraph(root)
        const fromPure = renderTreeCover(graph, {budget: 3})
        const fromLegacy = renderAutoView(projectPath, {budget: 3}).output
        expect(fromPure).toBe(fromLegacy)
    })

    it('produces identical output for larger project with nested folders', () => {
        const projectPath = makeLargeFixtureProject()
        const root = path.resolve(projectPath)
        const graph = buildAutoViewGraph(root)
        const fromPure = renderTreeCover(graph, {budget: 1000})
        const fromLegacy = renderAutoView(projectPath, {budget: 1000}).output
        expect(fromPure).toBe(fromLegacy)
    })

    it('returns empty string for empty graph', () => {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-render-tree-cover-empty-'))
        tempDirs.push(tempDir)
        const graph = buildAutoViewGraph(path.resolve(tempDir))
        expect(renderTreeCover(graph)).toBe('')
    })

    it('is a pure function: same graph + opts produces same output', () => {
        const projectPath = makeFixtureProject()
        const root = path.resolve(projectPath)
        const graph = buildAutoViewGraph(root)
        const opts = {budget: 3}
        const first = renderTreeCover(graph, opts)
        const second = renderTreeCover(graph, opts)
        expect(first).toBe(second)
    })

    it('accepts selected as ReadonlySet and matches selectedIds behavior', () => {
        const projectPath = makeFixtureProject()
        const root = path.resolve(projectPath)
        const graph = buildAutoViewGraph(root)
        const nodeId = graph.nodes[0]!.id
        const fromSet = renderTreeCover(graph, {budget: 3, selected: new Set([nodeId])})
        const fromLegacy = renderAutoView(projectPath, {budget: 3, selectedIds: [nodeId]}).output
        expect(fromSet).toBe(fromLegacy)
    })

    it('snapshot: uncollapsed small project', () => {
        const projectPath = makeFixtureProject()
        const root = path.resolve(projectPath)
        const graph = buildAutoViewGraph(root)
        const output = renderTreeCover(graph, {budget: 1000})
        expect(output).toContain('# format: tree-cover (auto-selected)')
        expect(output).toContain('═══ SPINE (folder hierarchy, no content edges) ═══')
        expect(output).toContain('═══ COVER FOREST')
        expect(output).not.toContain('[collapsed:')
    })

    it('snapshot: collapsed small project', () => {
        const projectPath = makeFixtureProject()
        const root = path.resolve(projectPath)
        const graph = buildAutoViewGraph(root)
        const output = renderTreeCover(graph, {budget: 3})
        expect(output).toContain('# budget: 3 visible entities')
        expect(output).toContain('[collapsed:')
        expect(output).toContain('# hint: to expand a collapsed')
    })

    it('uses explicit title and view-applied marker for daemon-rendered views', () => {
        const projectPath = makeFixtureProject()
        const root = path.resolve(projectPath)
        const graph = buildAutoViewGraph(root)
        const output = renderTreeCover(graph, {
            budget: 1000,
            title: 'docs',
            viewApplied: true,
        })

        expect(output.split('\n')[0]).toBe('═══ STRUCTURE docs (view applied) ═══')
    })

    it('normalizes daemon projected folder paths under the render root', () => {
        const graph = {
            nodes: [
                {
                    id: '/project/alpha.md',
                    kind: 'file' as const,
                    label: 'Alpha',
                    relPath: 'alpha.md',
                    basename: 'alpha.md',
                    folderPath: '/project/',
                    content: 'Alpha',
                },
                {
                    id: '/project/docs/beta.md',
                    kind: 'file' as const,
                    label: 'Beta',
                    relPath: 'docs/beta.md',
                    basename: 'beta.md',
                    folderPath: '/project/docs/',
                    content: 'Beta',
                },
            ],
            edges: [],
            rootPath: '/project',
            revision: 0,
            forests: [],
            arboricity: 0,
        }

        const output = renderTreeCover(graph, {title: 'project', viewApplied: true})

        expect(output).toContain('▢ project/')
        expect(output).toContain('├── ▢ docs/')
        expect(output).not.toContain('▢ project/\n└── ▢ project/')
    })

    it('forces user-collapsed folders to render as collapsed clusters', () => {
        const graph = {
            nodes: [
                {
                    id: '/project/docs/a.md',
                    kind: 'file' as const,
                    label: 'A',
                    relPath: 'docs/a.md',
                    basename: 'a.md',
                    folderPath: '/project/docs/',
                    content: 'A',
                },
                {
                    id: '/project/docs/b.md',
                    kind: 'file' as const,
                    label: 'B',
                    relPath: 'docs/b.md',
                    basename: 'b.md',
                    folderPath: '/project/docs/',
                    content: 'B',
                },
            ],
            edges: [],
            rootPath: '/project',
            revision: 0,
            forests: [],
            arboricity: 0,
        }

        const output = renderTreeCover(graph, {
            collapsed: new Set(['/project/docs']),
            title: 'project',
            viewApplied: true,
        })

        expect(output).toContain('▢ docs/ [collapsed:user 2 nodes')
        expect(output).not.toContain('· A @[docs/a.md]')
    })

    it('renders daemon-projected collapsed folders without child nodes present', () => {
        const graph = {
            nodes: [
                {
                    id: '/project/docs/',
                    kind: 'folder-collapsed' as const,
                    label: 'docs',
                    relPath: 'docs/',
                    basename: 'docs',
                    folderPath: '',
                    content: '',
                    childCount: 2,
                    loadState: 'not-loaded' as const,
                    isWriteTarget: false,
                },
            ],
            edges: [],
            rootPath: '/project',
            revision: 0,
            forests: [],
            arboricity: 0,
        }

        const output = renderTreeCover(graph, {title: 'main', viewApplied: true})

        expect(output).toContain('▢ docs/ [collapsed:user 2 nodes')
        expect(output).toContain('═══ STRUCTURE main (view applied) ═══')
    })
})
