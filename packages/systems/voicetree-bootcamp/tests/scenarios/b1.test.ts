import {promises as fs} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {b1} from '../../src/scenarios/b1.ts'

describe('b1 — cold-start with daemon recovery', () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b1-test-'))
    })
    afterEach(async () => {
        await fs.rm(tempDir, {recursive: true, force: true})
    })

    it('exports a valid ScenarioSpec literal', () => {
        expect(b1.id).toBe('B1')
        expect(b1.taskPrompt).toContain('dialing in espresso')
        expect(b1.expectedCommands.map((c) => c.verb)).toContain('graph structure')
        expect(b1.budgets.tokens).toBe(9000)
    })

    it('setup writes the cooldown breadcrumb and README', async () => {
        await b1.setup(tempDir)
        const cooldown = path.join(tempDir, '.voicetree', 'graphd.cooldown.json')
        const cooldownContent = JSON.parse(await fs.readFile(cooldown, 'utf8'))
        expect(typeof cooldownContent.untilMs).toBe('number')
        expect(cooldownContent.untilMs).toBeGreaterThan(Date.now())
        expect(cooldownContent.reason).toMatch(/synthetic/)
        const readme = await fs.readFile(path.join(tempDir, 'README.md'), 'utf8')
        expect(readme).toContain('Espresso notes')
    })

    it('successCriteria passes when cooldown is cleared and 3 linked espresso notes exist', async () => {
        await b1.setup(tempDir)
        await fs.unlink(path.join(tempDir, '.voicetree', 'graphd.cooldown.json'))
        await fs.writeFile(
            path.join(tempDir, 'grind.md'),
            '# Grind\n\nDial in the grind setting; finer than v60.\n',
        )
        await fs.writeFile(
            path.join(tempDir, 'dose.md'),
            '---\nparent: grind\n---\n# Dose\n\n18g dose into the basket.\n',
        )
        await fs.writeFile(
            path.join(tempDir, 'extraction.md'),
            '# Extraction\n\nSee [[grind]] for the upstream control on extraction time.\n',
        )
        const result = await b1.successCriteria(tempDir)
        expect(result.passed).toBe(true)
        expect(result.detail).toContain('espresso notes')
    })

    it('successCriteria fails when the cooldown breadcrumb is still present', async () => {
        await b1.setup(tempDir)
        await fs.writeFile(path.join(tempDir, 'grind.md'), '# Grind\n\n[[dose]]\n')
        await fs.writeFile(path.join(tempDir, 'dose.md'), '# Dose\n\n[[extraction]]\n')
        await fs.writeFile(path.join(tempDir, 'extraction.md'), '# Extraction\n\n')
        const result = await b1.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/cooldown breadcrumb/)
    })

    it('successCriteria fails when fewer than 3 espresso-keyword notes are present', async () => {
        await b1.setup(tempDir)
        await fs.unlink(path.join(tempDir, '.voicetree', 'graphd.cooldown.json'))
        await fs.writeFile(path.join(tempDir, 'grind.md'), '# Grind\n\nFine.\n')
        await fs.writeFile(path.join(tempDir, 'unrelated.md'), '# Unrelated\n\nFoo bar.\n')
        const result = await b1.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/expected ≥3/)
    })
})
