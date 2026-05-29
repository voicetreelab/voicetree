import {mkdtemp, mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

import {describe, expect, it} from 'vitest'

import {checkProjectVocabulary} from './project-vocabulary.ts'

const legacyTerm = ['v', 'ault'].join('')
const legacyHomeTerm = ['app', 'Support'].join('')

describe('checkProjectVocabulary', () => {
    it('reports legacy terms in active file contents and paths', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        await mkdir(join(repoRoot, `bad-${legacyTerm}`))
        await writeFile(join(repoRoot, `bad-${legacyTerm}`, 'example.ts'), `const x = '${legacyTerm}'\n`)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([
            {
                path: `bad-${legacyTerm}/example.ts`,
                line: null,
                column: null,
                source: 'path',
                term: legacyTerm,
            },
            {
                path: `bad-${legacyTerm}/example.ts`,
                line: 1,
                column: 12,
                source: 'content',
                term: legacyTerm,
            },
        ])
        expect(result.report).toContain('Project vocabulary drift')
    })

    it('ignores archived historical folders', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        await mkdir(join(repoRoot, 'voicetree-20-5'))
        await writeFile(join(repoRoot, 'voicetree-20-5', 'old.md'), legacyTerm)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })

    it('reports legacy global-home terminology', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        await writeFile(join(repoRoot, 'example.ts'), `const ${legacyHomeTerm} = '/tmp/home'\n`)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([
            {
                path: 'example.ts',
                line: 1,
                column: 7,
                source: 'content',
                term: legacyHomeTerm,
            },
        ])
    })
})
