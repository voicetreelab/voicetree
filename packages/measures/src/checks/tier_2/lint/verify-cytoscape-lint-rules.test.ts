import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '../../../../../..')
const ESLINT_CONFIG = join(REPO_ROOT, 'webapp/eslint.config.js')
const requireFromWebapp = createRequire(join(REPO_ROOT, 'webapp/package.json'))

type EslintMessage = {
    readonly ruleId: string | null
    readonly message: string
}

type EslintResult = {
    readonly errorCount: number
    readonly messages: readonly EslintMessage[]
}

type EslintConfig = {
    readonly rules?: Record<string, unknown>
}

type EslintRunner = {
    readonly lintText: (
        text: string,
        options: {readonly filePath: string},
    ) => Promise<readonly EslintResult[]>
    readonly calculateConfigForFile: (filePath: string) => Promise<EslintConfig>
}

type EslintConstructor = new (
    options: {readonly cwd: string, readonly overrideConfigFile: string},
) => EslintRunner

type LinterMessage = {
    readonly ruleId: string | null
    readonly message: string
}

type LinterRunner = {
    readonly verify: (
        text: string,
        config: readonly unknown[],
        options: {readonly filename: string},
    ) => readonly LinterMessage[]
}

type LinterConstructor = new (
    options: {readonly configType: 'flat'},
) => LinterRunner

const {ESLint, Linter} = requireFromWebapp('eslint') as {
    readonly ESLint: EslintConstructor
    readonly Linter: LinterConstructor
}

type LintResult = {
    readonly exitCode: number
    readonly output: string
}

type LintTextCase = {
    readonly label: string
    readonly relativePath: string
    readonly content: string
    readonly expectedSnippets: readonly string[]
}

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

function formatLintOutput(relativePath: string, messages: readonly EslintMessage[]): string {
    return messages
        .map(message => [
            relativePath,
            message.ruleId ?? '',
            message.message,
        ].join('\n'))
        .join('\n\n')
}

async function lintTextWithRepoConfig({
    label,
    relativePath,
    content,
    expectedSnippets,
}: LintTextCase): Promise<void> {
    const absolutePath = join(REPO_ROOT, relativePath)
    const eslint = new ESLint({cwd: REPO_ROOT, overrideConfigFile: ESLINT_CONFIG})
    const [result] = await eslint.lintText(content, {filePath: absolutePath})
    expect(result, `${label}: ESLint did not return a lint result.`).toBeDefined()
    if (!result) {
        return
    }
    const output = formatLintOutput(relativePath, result.messages)

    expect(result.errorCount, `${label}: lint unexpectedly passed with a seeded violation.`).not.toBe(0)
    for (const snippet of expectedSnippets) {
        expect(output, `${label}: lint output did not include "${snippet}".`).toContain(snippet)
    }
}

function getNoRestrictedSyntaxRule(config: EslintConfig): unknown {
    const rule = config.rules?.['no-restricted-syntax']
    expect(rule, 'Expected no-restricted-syntax to apply to the business-layer path.').toBeDefined()
    return rule
}

function lintTextWithRestrictedSyntaxRule(content: string, relativePath: string, rule: unknown): readonly LinterMessage[] {
    const linter = new Linter({configType: 'flat'})
    return linter.verify(content, [{
        files: ['**/*.ts'],
        rules: {
            'no-restricted-syntax': rule,
        },
    }], {filename: join(REPO_ROOT, relativePath)})
}

describe.sequential('cytoscape lint rules', () => {
    it('passes the current root lint scope before seeding violations', () => {
        const result = runRootLint()

        expect(result.exitCode, result.output).toBe(0)
    })

    it('rejects Cytoscape imports in pure graph packages', async () => {
        await lintTextWithRepoConfig({
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

    it('rejects business-layer cy member access without requiring the business folder to exist', async () => {
        const relativePath = 'webapp/src/shell/business/SEED_VIOLATION.ts'
        const eslint = new ESLint({cwd: REPO_ROOT, overrideConfigFile: ESLINT_CONFIG})
        const config = await eslint.calculateConfigForFile(join(REPO_ROOT, relativePath))
        const rule = getNoRestrictedSyntaxRule(config)
        const content = [
            'const cy = {',
            '    add: (_node) => undefined,',
            '}',
            '',
            'cy.add({ data: { id: "seed" } })',
        ].join('\n')
        const messages = lintTextWithRestrictedSyntaxRule(content, relativePath, rule)
        const output = formatLintOutput(relativePath, messages)

        expect(output).toContain(relativePath)
        expect(output).toContain('no-restricted-syntax')
        expect(output).toContain('Business-layer files must not reach into Cytoscape via cy.*.')
    })
})
