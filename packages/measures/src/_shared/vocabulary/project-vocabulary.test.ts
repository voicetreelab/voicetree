import {execFileSync} from 'node:child_process'
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

import {describe, expect, it} from 'vitest'

import {checkProjectVocabulary} from './project-vocabulary.ts'

const legacyTerm = ['v', 'ault'].join('')
const legacyHomeTerm = ['app', 'Support'].join('')

async function makeRepo(): Promise<string> {
    const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
    execFileSync('git', ['init', '-q'], {cwd: repoRoot})
    return repoRoot
}

/** Stage everything written so far so `git ls-files` reports it as tracked. */
function track(repoRoot: string): void {
    execFileSync('git', ['add', '-A'], {cwd: repoRoot})
}

describe('checkProjectVocabulary', () => {
    it('reports legacy terms in tracked file contents and paths', async () => {
        const repoRoot = await makeRepo()
        await mkdir(join(repoRoot, `bad-${legacyTerm}`))
        await writeFile(join(repoRoot, `bad-${legacyTerm}`, 'example.ts'), `const x = '${legacyTerm}'\n`)
        track(repoRoot)

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

    it('ignores untracked files (caches like .ck/, uncommitted fixtures)', async () => {
        const repoRoot = await makeRepo()
        // Written to disk but never `git add`ed — the previous filesystem walk
        // would flag these; tracked-file enumeration must not.
        await mkdir(join(repoRoot, '.ck'))
        await writeFile(join(repoRoot, '.ck', `${legacyTerm}NotOpen.ts.ck`), `cached ${legacyTerm}`)
        await mkdir(join(repoRoot, `markdownTree${legacyTerm[0].toUpperCase()}${legacyTerm.slice(1)}Default`))
        await writeFile(
            join(repoRoot, `markdownTree${legacyTerm[0].toUpperCase()}${legacyTerm.slice(1)}Default`, 'node.md'),
            'fixture',
        )

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })

    it('ignores archived historical folders even when tracked', async () => {
        const repoRoot = await makeRepo()
        await mkdir(join(repoRoot, 'voicetree-20-5'))
        await writeFile(join(repoRoot, 'voicetree-20-5', 'old.md'), legacyTerm)
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })

    it('reports legacy global-home terminology in tracked files', async () => {
        const repoRoot = await makeRepo()
        await writeFile(join(repoRoot, 'example.ts'), `const ${legacyHomeTerm} = '/tmp/home'\n`)
        track(repoRoot)

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

    it('honors an inline allow directive for the named term in the declaring file', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        const directive = `project-vocabulary:allow ${legacyTerm}`
        await writeFile(
            join(repoRoot, 'integration.ts'),
            `// ${directive} — external tool owns this config key\nconst key = '${legacyTerm}'\n`,
        )

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })

    it('scopes an allow directive to its own file and to the named term only', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        const directive = `project-vocabulary:allow ${legacyTerm}`
        // declares the allow → exempt
        await writeFile(join(repoRoot, 'allowed.ts'), `// ${directive}\nconst a = '${legacyTerm}'\n`)
        // no directive → still flagged
        await writeFile(join(repoRoot, 'other.ts'), `const b = '${legacyTerm}'\n`)
        // allowing one term must not exempt a different legacy term in the same file
        await writeFile(join(repoRoot, 'mixed.ts'), `// ${directive}\nconst ${legacyHomeTerm} = 1\n`)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations.map(violation => violation.path).sort()).toEqual(['mixed.ts', 'other.ts'])
    })
})
