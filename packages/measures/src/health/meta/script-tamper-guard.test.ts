import {execSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'
import {basename, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_DIR, '../../../../..')

function runGit(args: string): string {
    return execSync(`git ${args}`, {cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']})
}

function tryRunGit(args: string): string | null {
    try {
        return runGit(args)
    } catch {
        return null
    }
}

function changedStatusEntries(): string[] {
    const output = tryRunGit('status --porcelain') ?? ''
    return output.split('\n').map(line => line.trimEnd()).filter(Boolean)
}

function isExpectedMeasuresScriptMove(scriptName: string, current: unknown, committed: unknown): boolean {
    return scriptName === 'test:measures'
        && current === 'npm --workspace @vt/measures run test'
        && committed === undefined
}

function isMovedCodebaseHealthTest(path: string): boolean {
    if (!/^packages\/codebase-health\/src\/[^/]+\.test\.ts$/.test(path)) return false
    const movedHealthDirs = ['churn', 'complexity', 'coupling', 'meta', 'purity', 'shape']
    return movedHealthDirs.some(dir => existsSync(join(REPO_ROOT, 'packages/measures/src/health', dir, basename(path))))
}

function packageJsonScriptFindings(): string[] {
    const findings: string[] = []
    const currentPackageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {scripts?: Record<string, string>}
    const committedPackageJsonRaw = tryRunGit('show HEAD:package.json')
    if (!committedPackageJsonRaw) return findings

    const committedPackageJson = JSON.parse(committedPackageJsonRaw) as {scripts?: Record<string, string>}
    for (const scriptName of ['test', 'test:measures']) {
        const currentScript = currentPackageJson.scripts?.[scriptName]
        const committedScript = committedPackageJson.scripts?.[scriptName]
        if (
            currentScript !== committedScript
            && !isExpectedMeasuresScriptMove(scriptName, currentScript, committedScript)
        ) {
            findings.push(`package.json script "${scriptName}" changed; complexity pressure must not be won by relaxing green gates`)
        }
    }

    return findings
}

function headTrackedFiles(): Set<string> {
    const output = tryRunGit('ls-tree -r --name-only HEAD') ?? ''
    return new Set(output.split('\n').filter(Boolean))
}

// Prefixes that are deliberately absent from the working tree on the remote dev box
// (excluded by `scripts/dev-setup/remote/mutagen-vt-remote.yml`). A path missing from disk
// because mutagen never synced it is not a tamper signal.
const PARTIAL_MIRROR_PREFIXES: readonly string[] = ['webapp/workers/', 'old/']

function isInPartialMirrorPrefix(path: string): boolean {
    return PARTIAL_MIRROR_PREFIXES.some(prefix => path.startsWith(prefix))
}

function deletedTestFindings(): string[] {
    const head = headTrackedFiles()
    const deletedTests = changedStatusEntries()
        .filter(line => line.startsWith('D ') || line.startsWith(' D'))
        .map(line => line.slice(2).trim())
        .filter(path => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path))
        .filter(path => !isMovedCodebaseHealthTest(path))
        .filter(path => head.has(path))
        .filter(path => !existsSync(join(REPO_ROOT, path)))
        .filter(path => !isInPartialMirrorPrefix(path))

    return deletedTests.length === 0 ? [] : [`deleted test files detected: ${deletedTests.join(', ')}`]
}

function missingGateFileFindings(): string[] {
    const requiredFiles = [
        'packages/measures/src/health/meta/gate-integrity.test.ts',
        'packages/measures/src/health/meta/script-tamper-guard.test.ts',
        'packages/measures/src/health/purity/purity-ratio-ast.test.ts',
        'packages/measures/src/health/complexity/cognitive-complexity.test.ts',
        'packages/measures/src/health/coupling/cross-package-coupling.test.ts',
    ]

    return requiredFiles
        .filter(file => !existsSync(join(REPO_ROOT, file)))
        .map(file => `required health gate file missing: ${file}`)
}

function guardFindings(): string[] {
    return [
        ...packageJsonScriptFindings(),
        ...deletedTestFindings(),
        ...missingGateFileFindings(),
    ]
}

describe('script tamper guard', () => {
    it('detects unauthorized modifications to npm scripts and gate tests', async () => {
        const violations = guardFindings()

        await recordHealthMetric({
            metricId: 'script-tamper-guard',
            metricName: 'Script Tamper Guard',
            description: 'Detects unauthorized modifications to npm scripts',
            category: 'Other',
            current: violations.length,
            budget: 0,
            comparison: 'lte',
            details: {violations},
        })

        expect(violations, violations.join('\n')).toEqual([])
    })
})
