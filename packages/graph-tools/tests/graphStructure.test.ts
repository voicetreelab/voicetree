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

        const result = getGraphStructure(tempDir)
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

    it('optionally includes content summaries below each node title', () => {
        const tempDir: string = mkdtempSync(path.join(os.tmpdir(), 'vt-graph-summary-'))
        tempDirs.push(tempDir)

        writeFileSync(
            path.join(tempDir, 'root.md'),
            [
                '---',
                'isContextNode: false',
                '---',
                '# Root',
                '',
                'First root detail',
                'Second root detail',
                'Third root detail',
                'Fourth root detail',
                '',
                '[[child]]',
                ''
            ].join('\n')
        )
        writeFileSync(
            path.join(tempDir, 'child.md'),
            [
                '# Child',
                '',
                'First child detail',
                'Second child detail',
                'Third child detail',
                ''
            ].join('\n')
        )

        const result = getGraphStructure(tempDir, {withSummaries: true})

        expect(result.ascii).toBe(`Root
  > First root detail
  > Second root detail
  > Third root detail
  └── Child
      > First child detail
      > Second child detail
      > Third child detail`)
    })
})
