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
        const repoRoot = await makeRepo()
        const directive = `project-vocabulary:allow ${legacyTerm}`
        await writeFile(
            join(repoRoot, 'integration.ts'),
            `// ${directive} — external tool owns this config key\nconst key = '${legacyTerm}'\n`,
        )
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })

    it('scopes an allow directive to its own file and to the named term only', async () => {
        const repoRoot = await makeRepo()
        const directive = `project-vocabulary:allow ${legacyTerm}`
        // declares the allow → exempt
        await writeFile(join(repoRoot, 'allowed.ts'), `// ${directive}\nconst a = '${legacyTerm}'\n`)
        // no directive → still flagged
        await writeFile(join(repoRoot, 'other.ts'), `const b = '${legacyTerm}'\n`)
        // allowing one term must not exempt a different legacy term in the same file
        await writeFile(join(repoRoot, 'mixed.ts'), `// ${directive}\nconst ${legacyHomeTerm} = 1\n`)
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations.map(violation => violation.path).sort()).toEqual(['mixed.ts', 'other.ts'])
    })
})

// Literal "mcp"/"MCP"/"vault" below is safe: the vocabulary module's own
// directory is self-excluded from the repo scan, so this test file never trips
// the gate. Each test scans an isolated temp repo, not this file. Banned terms
// are placed at column 1 so the expected coordinates are trivial.
describe('checkProjectVocabulary — mcp ban + allowances', () => {
    it('reports an mcp term in both path and content', async () => {
        const repoRoot = await makeRepo()
        await mkdir(join(repoRoot, 'mcp-feature'))
        await writeFile(join(repoRoot, 'mcp-feature', 'thing.ts'), 'MCP\n')
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([
            {path: 'mcp-feature/thing.ts', line: null, column: null, source: 'path', term: 'mcp'},
            {path: 'mcp-feature/thing.ts', line: 1, column: 1, source: 'content', term: 'MCP'},
        ])
    })

    it('suppresses an mcp occurrence inside a CONTEXT_ALLOWANCE substring', async () => {
        const repoRoot = await makeRepo()
        // `ToolResponse` is an allow-listed context (the live vt-daemon type).
        await writeFile(join(repoRoot, 'consumer.ts'), 'ToolResponse\n')
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })

    it('still flags a bare mcp mention even when an allowed context is present', async () => {
        const repoRoot = await makeRepo()
        await writeFile(join(repoRoot, 'consumer.ts'), 'ToolResponse\nMCP\n')
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        // The ToolResponse occurrence is suppressed; the bare "MCP" is not.
        expect(result.violations).toEqual([
            {path: 'consumer.ts', line: 2, column: 1, source: 'content', term: 'MCP'},
        ])
    })

    it('PATH_ALLOWANCE suppresses mcp but still enforces vault in the same file', async () => {
        const repoRoot = await makeRepo()
        // `packages/systems/vt-daemon/` is a path allowance (the ① layer pending rename).
        const dir = join(repoRoot, 'packages', 'systems', 'vt-daemon', 'src')
        await mkdir(dir, {recursive: true})
        await writeFile(join(dir, 'tool.ts'), `MCP\n${legacyTerm}\n`)
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([
            {
                path: 'packages/systems/vt-daemon/src/tool.ts',
                line: 2,
                column: 1,
                source: 'content',
                term: legacyTerm,
            },
        ])
    })

    it('exempts the vocabulary module\'s own directory entirely', async () => {
        const repoRoot = await makeRepo()
        const dir = join(repoRoot, 'packages', 'measures', 'src', '_shared', 'vocabulary')
        await mkdir(dir, {recursive: true})
        await writeFile(join(dir, 'extra.ts'), `MCP\n${legacyTerm}\n`)
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })

    it('excludes dependency lockfiles and generated playwright-report dirs', async () => {
        const repoRoot = await makeRepo()
        await writeFile(join(repoRoot, 'pnpm-lock.yaml'), 'integrity: sha512-MCP\n')
        await writeFile(join(repoRoot, 'package-lock.json'), '{"x":"MCP"}\n')
        await mkdir(join(repoRoot, 'playwright-report-tier2'))
        await writeFile(join(repoRoot, 'playwright-report-tier2', 'index.html'), '<p>mcp</p>\n')
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })
})

describe('checkProjectVocabulary — inline project-vocabulary:allow directive', () => {
    it('exempts only the named term for the declaring file', async () => {
        const repoRoot = await makeRepo()
        // Directive exempts vault for this file; the bare MCP is still flagged.
        await writeFile(
            join(repoRoot, 'config-reader.ts'),
            `// project-vocabulary:allow ${legacyTerm} — external system owns this key\nconst k = '${legacyTerm}'\nMCP\n`,
        )
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([
            {path: 'config-reader.ts', line: 3, column: 1, source: 'content', term: 'MCP'},
        ])
    })

    it('does not leak the exemption to other files', async () => {
        const repoRoot = await makeRepo()
        await writeFile(join(repoRoot, 'has-directive.ts'), `// project-vocabulary:allow ${legacyTerm}\n${legacyTerm}\n`)
        await writeFile(join(repoRoot, 'no-directive.ts'), `${legacyTerm}\n`)
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([
            {path: 'no-directive.ts', line: 1, column: 1, source: 'content', term: legacyTerm},
        ])
    })

    it('ignores directives for the path check (paths cannot carry one)', async () => {
        const repoRoot = await makeRepo()
        await mkdir(join(repoRoot, `bad-${legacyTerm}`))
        await writeFile(join(repoRoot, `bad-${legacyTerm}`, 'f.ts'), `// project-vocabulary:allow ${legacyTerm}\n${legacyTerm}\n`)
        track(repoRoot)

        const result = await checkProjectVocabulary(repoRoot)

        // Content vault is directive-exempt; the vault in the PATH is not.
        expect(result.violations).toEqual([
            {path: `bad-${legacyTerm}/f.ts`, line: null, column: null, source: 'path', term: legacyTerm},
        ])
    })
})
