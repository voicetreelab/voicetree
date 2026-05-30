import {execSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
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

function isExpectedMeasuresScriptMove(scriptName: string, current: unknown, committed: unknown): boolean {
    return scriptName === 'test:measures'
        && current === 'npm --workspace @vt/measures run test'
        && committed === undefined
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
        ...missingGateFileFindings(),
    ]
}

describe('script tamper guard', () => {
    it('detects unauthorized npm-script relaxations and missing gate files', async () => {
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
