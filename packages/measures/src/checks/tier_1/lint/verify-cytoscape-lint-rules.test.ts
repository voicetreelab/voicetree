import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, rmSync, rmdirSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '../../../../../..')
const ESLINT_CONFIG = join(REPO_ROOT, 'webapp/eslint.config.js')

type LintResult = {
    readonly exitCode: number
    readonly output: string
}

type SeededViolation = {
    readonly label: string
    readonly relativePath: string
    readonly content: string
    readonly expectedSnippets: readonly string[]
}

const seededPaths = new Set<string>()
const createdDirs = new Set<string>()

function runCommand(command: string, args: readonly string[]): LintResult {
    try {
        const output = execFileSync(command, [...args], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        })

        return {exitCode: 0, output}
    } catch (error) {
        const lintError = error as {readonly status?: number, readonly stdout?: string, readonly stderr?: string}
        return {
            exitCode: lintError.status ?? 1,
            output: `${lintError.stdout ?? ''}${lintError.stderr ?? ''}`,
        }
    }
}

function runRootLint(): LintResult {
    return runCommand('npm', ['run', 'lint'])
}

function runEslintFile(relativePath: string): LintResult {
    return runCommand('npm', [
        'exec',
        '--prefix',
        'webapp',
        '--',
        'eslint',
        '--no-error-on-unmatched-pattern',
        '--config',
        ESLINT_CONFIG,
        relativePath,
    ])
}

function cleanupSeededPaths(): void {
    for (const filePath of seededPaths) {
        rmSync(join(REPO_ROOT, filePath), {force: true})
    }
    seededPaths.clear()
    for (const dirPath of [...createdDirs].sort((a, b) => b.length - a.length)) {
        try {
            rmdirSync(dirPath)
        } catch {
            // Leave pre-existing or newly populated directories untouched.
        }
    }
    createdDirs.clear()
}

function seedViolationAndExpectFailure({
    label,
    relativePath,
    content,
    expectedSnippets,
}: SeededViolation): void {
    const absolutePath = join(REPO_ROOT, relativePath)
    const parentDir = dirname(absolutePath)
    if (!existsSync(parentDir)) {
        mkdirSync(parentDir, {recursive: true})
        createdDirs.add(parentDir)
    }
    writeFileSync(absolutePath, content)
    seededPaths.add(relativePath)

    const failingResult = runEslintFile(relativePath)

    expect(failingResult.exitCode, `${label}: lint unexpectedly passed with a seeded violation.`).not.toBe(0)
    for (const snippet of expectedSnippets) {
        expect(failingResult.output, `${label}: lint output did not include "${snippet}".`).toContain(snippet)
    }

    cleanupSeededPaths()
    const cleanResult = runRootLint()
    expect(cleanResult.exitCode, `${label}: lint did not recover after removing the seeded violation.\n${cleanResult.output}`).toBe(0)
}

describe.sequential('cytoscape lint rules', () => {
    afterEach(() => {
        cleanupSeededPaths()
    })

    it('passes the current root lint scope before seeding violations', () => {
        const result = runRootLint()

        expect(result.exitCode, result.output).toBe(0)
    })

    it('rejects Cytoscape imports in pure graph packages', () => {
        seedViolationAndExpectFailure({
            label: 'pure-package import rule',
            relativePath: 'packages/libraries/graph-model/src/SEED_VIOLATION.ts',
            content: 'import cytoscape from "cytoscape";\n',
            expectedSnippets: [
                'packages/libraries/graph-model/src/SEED_VIOLATION.ts',
                'no-restricted-imports',
                'Cytoscape must stay out of @vt/graph-model and @vt/graph-tools.',
            ],
        })
    })

    it('rejects business-layer cy member access', () => {
        seedViolationAndExpectFailure({
            label: 'business-layer cy.* rule',
            relativePath: 'webapp/src/shell/business/SEED_VIOLATION.ts',
            content: [
                'const cy: { add(node: { readonly data: { readonly id: string } }): unknown } = {',
                '    add: (_node) => undefined,',
                '}',
                '',
                'cy.add({ data: { id: "seed" } })',
            ].join('\n'),
            expectedSnippets: [
                'webapp/src/shell/business/SEED_VIOLATION.ts',
                'no-restricted-syntax',
                'Business-layer files must not reach into Cytoscape via cy.*.',
            ],
        })
    })
})
