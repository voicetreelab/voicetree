import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {resolveTypeForTarget} from './folderNoteType'

describe('resolveTypeForTarget', () => {
    let vaultRoot: string

    beforeEach(async () => {
        vaultRoot = await realpath(await mkdtemp(join(tmpdir(), 'vt-folder-note-type-')))
    })

    afterEach(async () => {
        await rm(vaultRoot, {recursive: true, force: true})
    })

    it('returns the type from the nearest folder note', async () => {
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(join(workDir, 'work.md'), '# Work\n\n## Type: my-kind\n', 'utf8')

        const targetPath: string = join(workDir, 'topic.md')
        const result = resolveTypeForTarget(targetPath, vaultRoot)

        expect(result).toEqual({
            typeName: 'my-kind',
            noteFilePath: join(workDir, 'work.md'),
        })
    })

    it('inherits the type from an ancestor folder note when the closer folder note has none', async () => {
        const workDir: string = join(vaultRoot, 'work')
        const researchDir: string = join(workDir, 'research')
        await mkdir(researchDir, {recursive: true})
        await writeFile(join(workDir, 'work.md'), '# Work\n\n## Type: parent-kind\n', 'utf8')
        await writeFile(join(researchDir, 'research.md'), '# Research\n\nno type declared here\n', 'utf8')

        const targetPath: string = join(researchDir, 'topic.md')
        const result = resolveTypeForTarget(targetPath, vaultRoot)

        expect(result).toEqual({
            typeName: 'parent-kind',
            noteFilePath: join(workDir, 'work.md'),
        })
    })

    it('prefers the closest ancestor folder note when both declare a type', async () => {
        const workDir: string = join(vaultRoot, 'work')
        const researchDir: string = join(workDir, 'research')
        await mkdir(researchDir, {recursive: true})
        await writeFile(join(workDir, 'work.md'), '# Work\n\n## Type: outer\n', 'utf8')
        await writeFile(join(researchDir, 'research.md'), '# Research\n\n## Type: inner\n', 'utf8')

        const result = resolveTypeForTarget(join(researchDir, 'topic.md'), vaultRoot)
        expect(result?.typeName).toBe('inner')
    })

    it('returns undefined when no upstream folder note declares a type', async () => {
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(join(workDir, 'work.md'), '# Work\n\nno type here\n', 'utf8')

        expect(resolveTypeForTarget(join(workDir, 'topic.md'), vaultRoot)).toBeUndefined()
    })

    it('returns undefined when the heading is mistyped', async () => {
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(join(workDir, 'work.md'), '# Work\n\n## Typo: my-kind\n## type: lowercase\n', 'utf8')

        expect(resolveTypeForTarget(join(workDir, 'topic.md'), vaultRoot)).toBeUndefined()
    })

    it('reads a separate-line scalar after a bare "## Type" heading', async () => {
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(join(workDir, 'work.md'), '# Work\n\n## Type\n\nmulti-line-kind\n', 'utf8')

        const result = resolveTypeForTarget(join(workDir, 'topic.md'), vaultRoot)
        expect(result?.typeName).toBe('multi-line-kind')
    })

    it('skips a folder note that matches the target itself', async () => {
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(join(workDir, 'work.md'), '# Work\n\n## Type: self-kind\n', 'utf8')

        const result = resolveTypeForTarget(join(workDir, 'work.md'), vaultRoot)
        expect(result).toBeUndefined()
    })

    it('honors the `index.md` folder-note convention', async () => {
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(join(workDir, 'index.md'), '# Work\n\n## Type: index-kind\n', 'utf8')

        const result = resolveTypeForTarget(join(workDir, 'topic.md'), vaultRoot)
        expect(result).toEqual({
            typeName: 'index-kind',
            noteFilePath: join(workDir, 'index.md'),
        })
    })

    it('prefers `index.md` over `<folder>.md` when both exist', async () => {
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(join(workDir, 'index.md'), '# Work\n\n## Type: index-kind\n', 'utf8')
        await writeFile(join(workDir, 'work.md'), '# Work\n\n## Type: basename-kind\n', 'utf8')

        const result = resolveTypeForTarget(join(workDir, 'topic.md'), vaultRoot)
        expect(result?.typeName).toBe('index-kind')
    })

    it('returns undefined when the target is outside the vault', async () => {
        const outsideDir: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-outside-')))
        try {
            await writeFile(join(outsideDir, 'note.md'), '# Note\n', 'utf8')
            expect(resolveTypeForTarget(join(outsideDir, 'note.md'), vaultRoot)).toBeUndefined()
        } finally {
            await rm(outsideDir, {recursive: true, force: true})
        }
    })
})
