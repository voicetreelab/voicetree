import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs'
import os from 'os'
import path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {getGraphStructure} from '../src/graphStructure'

describe('getGraphStructure', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const tempDir of tempDirs) {
            rmSync(tempDir, {recursive: true, force: true})
        }
        tempDirs.length = 0
    })

    it('renders markdown graph structure and ignores ctx-nodes plus hidden folders', () => {
        const tempDir: string = mkdtempSync(path.join(os.tmpdir(), 'vt-graph-'))
        tempDirs.push(tempDir)

        mkdirSync(path.join(tempDir, 'ctx-nodes'))
        mkdirSync(path.join(tempDir, '.hidden'))

        writeFileSync(path.join(tempDir, 'root.md'), '# Root\n\n[[child]]\n')
        writeFileSync(path.join(tempDir, 'child.md'), '# Child\n')
        writeFileSync(path.join(tempDir, 'orphan.md'), '# Orphan\n')
        writeFileSync(path.join(tempDir, 'ctx-nodes', 'ignored.md'), '# Ignored\n')
        writeFileSync(path.join(tempDir, '.hidden', 'hidden.md'), '# Hidden\n')

        const result = getGraphStructure(tempDir, {withSummaries: false})
        const lines: string[] = result.ascii.split('\n')

        expect(result.nodeCount).toBe(3)
        expect(result.orphanCount).toBe(1)
        expect(lines).toContain('Root')
        expect(lines).toContain('Orphan')
        expect(lines).toContain('└── Child')
        expect(result.ascii).not.toContain('Ignored')
        expect(result.ascii).not.toContain('Hidden')
    })

    it('returns an empty graph summary when no markdown files exist', () => {
        const tempDir: string = mkdtempSync(path.join(os.tmpdir(), 'vt-graph-empty-'))
        tempDirs.push(tempDir)

        const result = getGraphStructure(tempDir)

        expect(result.nodeCount).toBe(0)
        expect(result.orphanCount).toBe(0)
        expect(result.ascii).toBe('')
    })

    it('defaults to context-style output with node contents for folders with 30 or fewer nodes', () => {
        const tempDir: string = mkdtempSync(path.join(os.tmpdir(), 'vt-graph-context-'))
        tempDirs.push(tempDir)
        const rootPath: string = path.join(tempDir, 'root.md')
        const childPath: string = path.join(tempDir, 'child.md')

        writeFileSync(
            rootPath,
            [
                '---',
                'isContextNode: false',
                '---',
                '# Root',
                '',
                'First root detail',
                'Second root detail',
                'Third root detail',
                '[[child]]',
                ''
            ].join('\n')
        )
        writeFileSync(
            childPath,
            [
                '# Child',
                '',
                'Only child detail',
                ''
            ].join('\n')
        )

        const result = getGraphStructure(tempDir)

        expect(result.ascii).toBe([
            'Tree structure:',
            'Root',
            '└── Child',
            '',
            '## Node Contents',
            `- **Root** (${rootPath})`,
            '  First root detail',
            '  Second root detail',
            '  Third root detail',
            '  ...1 additional lines',
            `- **Child** (${childPath})`,
            '  Only child detail',
        ].join('\n'))
    })

    it('supports explicit topology-only mode for small folders', () => {
        const tempDir: string = mkdtempSync(path.join(os.tmpdir(), 'vt-graph-nosummary-'))
        tempDirs.push(tempDir)

        writeFileSync(path.join(tempDir, 'root.md'), '# Root\n\n[[child]]\n')
        writeFileSync(path.join(tempDir, 'child.md'), '# Child\n')

        const result = getGraphStructure(tempDir, {withSummaries: false})

        expect(result.ascii).toBe(`Root\n└── Child`)
    })

    it('groups summary output by subfolder containment', () => {
        const tempDir: string = mkdtempSync(path.join(os.tmpdir(), 'vt-graph-folder-'))
        tempDirs.push(tempDir)

        mkdirSync(path.join(tempDir, 'ideas'))
        writeFileSync(path.join(tempDir, 'root.md'), '# Root\n\nRoot detail\n')
        writeFileSync(path.join(tempDir, 'ideas', 'child.md'), '# Child\n\nChild detail\n')

        const result = getGraphStructure(tempDir)

        expect(result.ascii).toContain('ideas/')
        expect(result.ascii).toContain('└── Child')
        expect(result.ascii).toContain('## Node Contents')
    })

    it('falls back to compact topology plus a hint for folders larger than 30 nodes', () => {
        const tempDir: string = mkdtempSync(path.join(os.tmpdir(), 'vt-graph-large-'))
        tempDirs.push(tempDir)

        for (let index: number = 0; index < 31; index += 1) {
            writeFileSync(path.join(tempDir, `node-${index}.md`), `# Node ${index}\n`)
        }

        const result = getGraphStructure(tempDir)

        expect(result.nodeCount).toBe(31)
        expect(result.ascii).not.toContain('## Node Contents')
        expect(result.ascii).toContain('31 nodes — use --with-summaries for content')
    })
})
