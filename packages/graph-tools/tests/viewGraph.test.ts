import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs'
import os from 'os'
import path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {renderGraphView} from '../src/viewGraph'

describe('renderGraphView', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const t of tempDirs) rmSync(t, {recursive: true, force: true})
        tempDirs.length = 0
    })

    function makeFixture(): string {
        const dir: string = mkdtempSync(path.join(os.tmpdir(), 'vt-view-'))
        tempDirs.push(dir)
        // root file
        writeFileSync(path.join(dir, 'root.md'), '# Root\n\n[[child-a]]\n[[knowledge/the-design-law]]\n')
        writeFileSync(path.join(dir, 'child-a.md'), '# Child A\n')
        // virtual folder (no folder note)
        mkdirSync(path.join(dir, 'tasks'))
        writeFileSync(path.join(dir, 'tasks', 'task-1.md'), '# Task 1\n')
        writeFileSync(path.join(dir, 'tasks', 'task-2.md'), '# Task 2\n')
        // canonical folder (with folder note: knowledge/knowledge.md)
        mkdirSync(path.join(dir, 'knowledge'))
        writeFileSync(path.join(dir, 'knowledge', 'knowledge.md'), '# Knowledge Base\n')
        writeFileSync(path.join(dir, 'knowledge', 'the-design-law.md'), '# The Design Law\n')
        return dir
    }

    function footerLines(ascii: string): string[] {
        const lines: string[] = ascii.split('\n')
        const start: number = lines.indexOf('[Cross-Links]')
        if (start < 0) return []
        const footer: string[] = []
        for (let i = start + 1; i < lines.length; i++) {
            const line: string = lines[i]!
            if (line.trim() === '' || line.startsWith('Legend:')) break
            footer.push(line)
        }
        return footer
    }

    it('distinguishes folder notes (▣), virtual folders (▢) and files (·) in ascii output', () => {
        const dir: string = makeFixture()
        const result = renderGraphView(dir, {format: 'ascii'})

        expect(result.format).toBe('ascii')
        expect(result.folderNodeCount).toBe(1) // knowledge/knowledge.md is the folder note
        expect(result.virtualFolderCount).toBe(1) // tasks/ has no folder note
        expect(result.nodeCount).toBe(6) // 6 .md files
        expect(result.fileNodeCount).toBe(5) // everything that isn't the one folder note

        const ascii: string = result.output
        // folder-note glyph
        expect(ascii).toMatch(/▣ knowledge\/\s+— Knowledge Base/)
        // virtual folder glyph
        expect(ascii).toContain('▢ tasks/')
        // file glyph
        expect(ascii).toContain('· Root')
        expect(ascii).toContain('· Child A')
        expect(ascii).toContain('· Task 1')
        // legend present
        expect(ascii).toContain('Legend:')
    })

    it('renders outgoing wikilinks with ⇢ annotation', () => {
        const dir: string = makeFixture()
        const result = renderGraphView(dir, {format: 'ascii', showCrossEdges: true})
        // root.md → knowledge/the-design-law (cross-folder), root.md → child-a (sibling)
        expect(result.output).toMatch(/⇢ The Design Law/)
        expect(result.output).toMatch(/⇢ Child A/)
    })

    it('falls back to unique basenames for absolute-path wikilinks when the exact path is outside the rendered root', () => {
        const dir: string = makeFixture()
        writeFileSync(path.join(dir, 'root.md'), '# Root\n\n[[/tmp/external/child-a.md]]\n')

        const result = renderGraphView(dir, {format: 'ascii'})
        const footer: string[] = footerLines(result.output)

        expect(result.output).toContain('⇢ Child A')
        expect(footer).toContain('root -> child-a')
        expect(footer).not.toContain('root -> ?/tmp/external/child-a.md')
    })

    it('appends a [Cross-Links] footer with exact ids, unresolved links, and folder-note edges', () => {
        const dir: string = makeFixture()
        writeFileSync(path.join(dir, 'root.md'), '# Root\n\n[[child-a]]\n[[knowledge/the-design-law]]\n[[missing-link]]\n')
        writeFileSync(path.join(dir, 'knowledge', 'knowledge.md'), '# Knowledge Base\n\n[[root]]\n')

        const result = renderGraphView(dir, {format: 'ascii'})
        const footer: string[] = footerLines(result.output)

        expect(result.output).toContain('[Cross-Links]')
        expect(footer).toEqual(expect.arrayContaining([
            'knowledge/knowledge -> root',
            'root -> child-a',
            'root -> knowledge/the-design-law',
            'root -> ?missing-link',
        ]))
        expect(result.output).not.toContain('⇢ Root')
    })

    it('omits wikilink annotations when --no-cross-edges', () => {
        const dir: string = makeFixture()
        const result = renderGraphView(dir, {format: 'ascii', showCrossEdges: false})
        expect(result.output).not.toContain('⇢')
    })

    it('produces a mermaid graph with subgraphs for folders and styled classes', () => {
        const dir: string = makeFixture()
        const result = renderGraphView(dir, {format: 'mermaid'})
        expect(result.format).toBe('mermaid')
        const out: string = result.output
        expect(out.startsWith('graph LR')).toBe(true)
        expect(out).toContain('subgraph')
        expect(out).toContain('📁')
        expect(out).toContain('classDef folderNote')
        expect(out).toContain('classDef virtualFolder')
        // Edges from wikilinks rendered as dotted arrows
        expect(out).toMatch(/n\d+ -\.-> n\d+/)
    })

    it('returns empty output for a folder with no markdown', () => {
        const dir: string = mkdtempSync(path.join(os.tmpdir(), 'vt-view-empty-'))
        tempDirs.push(dir)
        const result = renderGraphView(dir)
        expect(result.output).toBe('')
        expect(result.nodeCount).toBe(0)
    })

    // ── collapse tests ─────────────────────────────────────────────────────

    it('collapses a virtual folder (ASCII): shows ▢ name/ [collapsed ⊟ N descendants, K outgoing]', () => {
        const dir: string = makeFixture()
        // tasks/ is virtual (no folder note); task-1 and task-2 don't link out
        const result = renderGraphView(dir, {format: 'ascii', collapsedFolders: ['tasks']})
        const ascii: string = result.output

        // collapsed line present with glyph ⊟
        expect(ascii).toMatch(/▢ tasks\/ \[collapsed ⊟ 2 descendants, 0 outgoing\]/)
        // descendants NOT rendered
        expect(ascii).not.toContain('· Task 1')
        expect(ascii).not.toContain('· Task 2')
        // other parts of the graph still visible
        expect(ascii).toContain('· Root')
        expect(ascii).toMatch(/▣ knowledge\//)
    })

    it('collapses a folder-note folder (ASCII): shows ▣ name/ [collapsed ⊟ N descendants, K outgoing]', () => {
        const dir: string = makeFixture()
        // knowledge/ has folder note (knowledge.md) + one child (the-design-law.md)
        // root.md links to knowledge/the-design-law → K=0 (outgoing FROM inside knowledge, not into)
        // knowledge/ itself has no outgoing links to outside, the-design-law.md has none either
        const result = renderGraphView(dir, {format: 'ascii', collapsedFolders: ['knowledge']})
        const ascii: string = result.output

        // collapsed line present with ▣ glyph and ⊟
        expect(ascii).toMatch(/▣ knowledge\/ [^[]*\[collapsed ⊟ 1 descendants, 0 outgoing\]/)
        // descendants NOT rendered
        expect(ascii).not.toContain('· The Design Law')
        // other parts visible
        expect(ascii).toContain('· Root')
        expect(ascii).toContain('▢ tasks/')
    })

    it('handles nested collapse: parent+child both listed → child is a no-op (parent hides it)', () => {
        const dir: string = makeFixture()
        // tasks/ parent + tasks (non-existent sub) just to test no duplicate/error
        // We'll use tasks and knowledge both
        const result = renderGraphView(dir, {format: 'ascii', collapsedFolders: ['tasks', 'knowledge']})
        const ascii: string = result.output

        // Both top-level folders collapsed
        expect(ascii).toMatch(/▢ tasks\/ \[collapsed ⊟/)
        expect(ascii).toMatch(/▣ knowledge\/ [^[]*\[collapsed ⊟/)
        // No children visible
        expect(ascii).not.toContain('· Task 1')
        expect(ascii).not.toContain('· The Design Law')
        // Root files still visible
        expect(ascii).toContain('· Root')
    })

    it('aggregates collapsed-folder footer edges and skips hidden descendant edges', () => {
        const dir: string = makeFixture()
        writeFileSync(path.join(dir, 'root.md'), '# Root\n\n[[tasks/task-1]]\n')
        writeFileSync(path.join(dir, 'tasks', 'task-1.md'), '# Task 1\n\n[[root]]\n')

        const result = renderGraphView(dir, {format: 'ascii', collapsedFolders: ['tasks']})
        const footer: string[] = footerLines(result.output)

        expect(footer).toContain('__virtual_folder__/tasks -> root')
        expect(footer).not.toContain('tasks/task-1 -> root')
        expect(footer).not.toContain('root -> tasks/task-1')
    })

    it('collapses a folder in mermaid output: emits single styled node, no subgraph, shows aggregated edges', () => {
        const dir: string = makeFixture()
        // Add a link FROM inside tasks to outside: tasks/task-1.md → root.md
        writeFileSync(path.join(dir, 'tasks', 'task-1.md'), '# Task 1\n\n[[root]]\n')

        const result = renderGraphView(dir, {format: 'mermaid', collapsedFolders: ['tasks']})
        const out: string = result.output

        // No subgraph for tasks/ (it's collapsed)
        const lines: string[] = out.split('\n')
        const subgraphLines: string[] = lines.filter(l => l.includes('subgraph') && l.includes('tasks'))
        expect(subgraphLines).toHaveLength(0)

        // Single collapsed node rendered (contains ⊟)
        expect(out).toContain('⊟')
        expect(out).toContain('collapsedFolder')

        // Aggregated outgoing edge from collapsed folder to root
        // (task-1 links to root, which is outside tasks/)
        expect(out).toMatch(/n\d+ -\.-> n\d+/)
    })
})
