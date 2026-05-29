import {promises as fs} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {b3} from '../../src/scenarios/b3.ts'

describe('b3 — reorganize 5 flat notes', () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b3-test-'))
    })
    afterEach(async () => {
        await fs.rm(tempDir, {recursive: true, force: true})
    })

    it('exports a valid ScenarioSpec literal', () => {
        expect(b3.id).toBe('B3')
        expect(b3.expectedCommands.map((c) => c.verb)).toEqual([
            'graph rename',
            'graph mv',
            'graph group',
            'graph structure',
        ])
    })

    it('setup writes 5 flat notes with the documented wikilinks', async () => {
        await b3.setup(tempDir)
        for (const name of ['note-1.md', 'note-2.md', 'note-3.md', 'note-4.md', 'note-5.md']) {
            const raw = await fs.readFile(path.join(tempDir, name), 'utf8')
            expect(raw.length).toBeGreaterThan(0)
        }
        const n1 = await fs.readFile(path.join(tempDir, 'note-1.md'), 'utf8')
        expect(n1).toContain('[[note-2]]')
        expect(n1).toContain('[[note-3]]')
    })

    it('successCriteria passes after a clean rename/mv/group operation that preserves links', async () => {
        await b3.setup(tempDir)
        await fs.unlink(path.join(tempDir, 'note-1.md'))
        // Rewrite intro.md keeping wikilinks valid.
        await fs.writeFile(path.join(tempDir, 'intro.md'), '# Intro\n\nSee [[note-2]] and [[note-3]].\n')
        // Move note-3 → chapters/note-3.md.
        const n3 = await fs.readFile(path.join(tempDir, 'note-3.md'), 'utf8')
        await fs.unlink(path.join(tempDir, 'note-3.md'))
        await fs.mkdir(path.join(tempDir, 'chapters'), {recursive: true})
        await fs.writeFile(path.join(tempDir, 'chapters', 'note-3.md'), n3)
        // Group note-2 + note-4 into archive/.
        const n2 = await fs.readFile(path.join(tempDir, 'note-2.md'), 'utf8')
        const n4 = await fs.readFile(path.join(tempDir, 'note-4.md'), 'utf8')
        await fs.unlink(path.join(tempDir, 'note-2.md'))
        await fs.unlink(path.join(tempDir, 'note-4.md'))
        await fs.mkdir(path.join(tempDir, 'archive'), {recursive: true})
        // Rewrite n2 to point at intro instead of note-1.
        await fs.writeFile(
            path.join(tempDir, 'archive', 'note-2.md'),
            n2.replace('[[note-1]]', '[[intro]]'),
        )
        await fs.writeFile(path.join(tempDir, 'archive', 'note-4.md'), n4)

        const result = await b3.successCriteria(tempDir)
        expect(result.passed).toBe(true)
    })

    it('successCriteria fails when an expected path is missing', async () => {
        await b3.setup(tempDir)
        // Don't move anything; note-1.md still exists, no intro.md exists.
        const result = await b3.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/expected path missing|note-1.md still exists/)
    })

    it('successCriteria fails when a wikilink dangles after reorganization', async () => {
        await b3.setup(tempDir)
        await fs.unlink(path.join(tempDir, 'note-1.md'))
        // intro.md still references [[note-2]] but note-2 has been deleted
        // (not moved to archive/).
        await fs.writeFile(path.join(tempDir, 'intro.md'), '# Intro\n\nSee [[note-2]] and [[note-3]].\n')
        const n3 = await fs.readFile(path.join(tempDir, 'note-3.md'), 'utf8')
        await fs.unlink(path.join(tempDir, 'note-3.md'))
        await fs.mkdir(path.join(tempDir, 'chapters'), {recursive: true})
        await fs.writeFile(path.join(tempDir, 'chapters', 'note-3.md'), n3)
        await fs.unlink(path.join(tempDir, 'note-2.md'))
        await fs.unlink(path.join(tempDir, 'note-4.md'))
        await fs.mkdir(path.join(tempDir, 'archive'), {recursive: true})
        // Deliberately omit archive/note-2.md → intro.md dangles.
        await fs.writeFile(path.join(tempDir, 'archive', 'note-4.md'), '# Note 4\n\nLinked from [[note-2]].\n')
        const result = await b3.successCriteria(tempDir)
        expect(result.passed).toBe(false)
    })
})
