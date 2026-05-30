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

// Literal "mcp"/"MCP"/"vault" below is safe: the vocabulary module's own
// directory is self-excluded from the repo scan, so this test file never trips
// the gate. Each test scans an isolated temp repo, not this file. Banned terms
// are placed at column 1 so the expected coordinates are trivial.
describe('checkProjectVocabulary — mcp ban + allowances', () => {
    it('reports an mcp term in both path and content', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        await mkdir(join(repoRoot, 'mcp-feature'))
        await writeFile(join(repoRoot, 'mcp-feature', 'thing.ts'), 'MCP\n')

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([
            {path: 'mcp-feature/thing.ts', line: null, column: null, source: 'path', term: 'mcp'},
            {path: 'mcp-feature/thing.ts', line: 1, column: 1, source: 'content', term: 'MCP'},
        ])
    })

    it('suppresses an mcp occurrence inside a CONTEXT_ALLOWANCE substring', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        // `McpToolResponse` is an allow-listed context (the live vt-daemon type).
        await writeFile(join(repoRoot, 'consumer.ts'), 'McpToolResponse\n')

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })

    it('still flags a bare mcp mention even when an allowed context is present', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        await writeFile(join(repoRoot, 'consumer.ts'), 'McpToolResponse\nMCP\n')

        const result = await checkProjectVocabulary(repoRoot)

        // The McpToolResponse occurrence is suppressed; the bare "MCP" is not.
        expect(result.violations).toEqual([
            {path: 'consumer.ts', line: 2, column: 1, source: 'content', term: 'MCP'},
        ])
    })

    it('PATH_ALLOWANCE suppresses mcp but still enforces vault in the same file', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        // `packages/systems/vt-daemon/` is a path allowance (the ① layer pending rename).
        const dir = join(repoRoot, 'packages', 'systems', 'vt-daemon', 'src')
        await mkdir(dir, {recursive: true})
        await writeFile(join(dir, 'tool.ts'), `MCP\n${legacyTerm}\n`)

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
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        const dir = join(repoRoot, 'packages', 'measures', 'src', '_shared', 'vocabulary')
        await mkdir(dir, {recursive: true})
        await writeFile(join(dir, 'extra.ts'), `MCP\n${legacyTerm}\n`)

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })

    it('excludes dependency lockfiles and generated playwright-report dirs', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'project-vocabulary-'))
        await writeFile(join(repoRoot, 'pnpm-lock.yaml'), 'integrity: sha512-MCP\n')
        await writeFile(join(repoRoot, 'package-lock.json'), '{"x":"MCP"}\n')
        await mkdir(join(repoRoot, 'playwright-report-tier2'))
        await writeFile(join(repoRoot, 'playwright-report-tier2', 'index.html'), '<p>mcp</p>\n')

        const result = await checkProjectVocabulary(repoRoot)

        expect(result.violations).toEqual([])
    })
})
