import {promises as fs} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {b5, writeB5Fixtures} from '../../src/scenarios/b5.ts'

describe('b5 — live edit + lint loop', () => {
    let tempDir: string
    let prevRealBin: string | undefined

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b5-test-'))
        prevRealBin = process.env.VT_REAL_BIN
    })
    afterEach(async () => {
        if (prevRealBin === undefined) delete process.env.VT_REAL_BIN
        else process.env.VT_REAL_BIN = prevRealBin
        await fs.rm(tempDir, {recursive: true, force: true})
    })

    it('exports a valid ScenarioSpec literal with the expected minCounts', () => {
        expect(b5.id).toBe('B5')
        const lintExpect = b5.expectedCommands.find((c) => c.verb === 'graph lint')
        const addEdgeExpect = b5.expectedCommands.find((c) => c.verb === 'graph live add-edge')
        expect(lintExpect?.minCount).toBe(2)
        expect(addEdgeExpect?.minCount).toBe(3)
        expect(typeof b5.teardown).toBe('function')
    })

    it('writeB5Fixtures lays down seed/ + bloated/ with the documented shape', async () => {
        await writeB5Fixtures(tempDir)
        for (const name of ['a.md', 'b.md', 'c.md']) {
            expect(await fs.readFile(path.join(tempDir, 'seed', name), 'utf8')).toContain('Seed node')
        }
        for (let i = 1; i <= 12; i++) {
            expect(await fs.readFile(path.join(tempDir, 'bloated', `child-${i}.md`), 'utf8')).toContain(
                `# Child ${i}`,
            )
        }
        const parent = await fs.readFile(path.join(tempDir, 'bloated', 'parent.md'), 'utf8')
        expect(parent).toContain('[[child-1]]')
        expect(parent).toContain('[[child-12]]')
    })

    it('successCriteria fails clearly when VT_REAL_BIN is not set', async () => {
        delete process.env.VT_REAL_BIN
        await writeB5Fixtures(tempDir)
        const result = await b5.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/VT_REAL_BIN/)
    })

    it('successCriteria fails when bloated/ fixture is missing', async () => {
        process.env.VT_REAL_BIN = '/usr/bin/false'
        const result = await b5.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/bloated\/ directory missing/)
    })

    it('successCriteria passes when a fake vt prints a zero-violation lint report', async () => {
        await writeB5Fixtures(tempDir)
        const fakeVt = await writeFakeVtPrintingJson(tempDir, {violations: []})
        process.env.VT_REAL_BIN = fakeVt
        const result = await b5.successCriteria(tempDir)
        expect(result.passed).toBe(true)
        expect(result.detail).toMatch(/lint re-verification/)
    })

    it('successCriteria fails when the lint report still shows violations', async () => {
        await writeB5Fixtures(tempDir)
        const fakeVt = await writeFakeVtPrintingJson(tempDir, {
            violations: [{kind: 'arity', node: 'bloated/parent.md'}],
        })
        process.env.VT_REAL_BIN = fakeVt
        const result = await b5.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/remaining violations/)
    })

    it.todo('integration — daemon-state-dump re-verification (Part 1) requires a running vt-graphd')

    it.todo('integration — full b5.setup() spawns vt-graphd; daemon owns the lifecycle for the rep')
})

async function writeFakeVtPrintingJson(tempDir: string, payload: unknown): Promise<string> {
    const binPath = path.join(tempDir, 'fake-vt.mjs')
    const script = `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(JSON.stringify(payload))})
`
    await fs.writeFile(binPath, script)
    await fs.chmod(binPath, 0o755)
    return binPath
}
