import {mkdtempSync, rmSync, writeFileSync} from 'fs'
import os from 'os'
import path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {renderGraphView} from '../src/viewGraph'

describe('renderGraphView selection', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const tempDir of tempDirs) {
            rmSync(tempDir, {recursive: true, force: true})
        }
        tempDirs.length = 0
    })

    function makeFixture(): string {
        const dir: string = mkdtempSync(path.join(os.tmpdir(), 'vt-view-select-'))
        tempDirs.push(dir)
        writeFileSync(path.join(dir, 'design.md'), '# design.md\n')
        writeFileSync(path.join(dir, 'notes.md'), '# notes.md\n')
        return dir
    }

    it('marks a basename-selected node in ascii output', () => {
        const dir: string = makeFixture()

        const result = renderGraphView(dir, {
            format: 'ascii',
            selectedIds: ['design.md'],
        })

        expect(result.output).toContain('★ · design.md')
        expect(result.output).not.toContain('★ · notes.md')
        expect(result.output).toContain('Legend: ★ selected')
    })

    it('emits a selected mermaid class for an absolute-path selection', () => {
        const dir: string = makeFixture()
        const selectedPath: string = path.join(dir, 'design.md')

        const result = renderGraphView(dir, {
            format: 'mermaid',
            selectedIds: [selectedPath],
        })

        expect(result.output).toContain('classDef selected stroke:#f93,stroke-width:3px,color:#222')
        expect(result.output).toMatch(/class n\d+ selected/)
    })
})
