// Black-box tests for the workflow reader. Build a real on-disk `workflows`
// tree in a tmp dir, call the public functions, assert on the returned tree /
// strings. No mocking — real filesystem side effects observed through outputs.

import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {listWorkflowsIn, readSkillFile, readSkillFileSummary} from './workflowReader.ts'

let root: string

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wf-reader-'))
})

afterEach(async () => {
    await rm(root, {recursive: true, force: true})
})

async function writeSkill(dir: string, body: string): Promise<string> {
    const full: string = join(root, dir)
    await mkdir(full, {recursive: true})
    await writeFile(join(full, 'SKILL.md'), body, 'utf-8')
    return full
}

describe('listWorkflowsIn', () => {
    it('returns the skill-bearing tree and prunes branches with no SKILL.md', async () => {
        await writeSkill('deep-research', '# Deep Research\nDoes research.')
        await mkdir(join(root, 'empty-dir'), {recursive: true})            // no SKILL.md anywhere → pruned
        await writeSkill('nested/inner', '# Inner\nNested skill.')          // parent kept for the child

        const tree = await listWorkflowsIn(root)
        const names: string[] = tree.map(n => n.name).sort()
        expect(names).toEqual(['deep-research', 'nested'])

        const research = tree.find(n => n.name === 'deep-research')!
        expect(research.hasSkillFile).toBe(true)

        const nested = tree.find(n => n.name === 'nested')!
        expect(nested.hasSkillFile).toBe(false)                            // no SKILL.md at this level
        expect(nested.children.map(c => c.name)).toEqual(['inner'])
        expect(nested.children[0].hasSkillFile).toBe(true)
    })

    it('creates the root and returns empty when it does not exist', async () => {
        const missing: string = join(root, 'does', 'not', 'exist')
        expect(await listWorkflowsIn(missing)).toEqual([])
    })
})

describe('readSkillFile', () => {
    it('strips a leading YAML frontmatter block and leading blank lines', async () => {
        const dir: string = await writeSkill(
            'with-fm',
            '---\nname: foo\nuser-invocable: true\n---\n\n# Foo\nThe body.',
        )
        expect(await readSkillFile(dir)).toBe('# Foo\nThe body.')
    })

    it('returns the body unchanged when there is no frontmatter', async () => {
        const dir: string = await writeSkill('no-fm', '# Bar\nPlain body.')
        expect(await readSkillFile(dir)).toBe('# Bar\nPlain body.')
    })
})

describe('readSkillFileSummary', () => {
    it('parses title + introduction into the compact summary', async () => {
        const dir: string = await writeSkill('summ', '---\nname: s\n---\n# My Skill\nAn intro line.')
        const summary: string = await readSkillFileSummary(dir)
        expect(summary).toContain('# My Skill')
        expect(summary).toContain('An intro line.')
    })
})
