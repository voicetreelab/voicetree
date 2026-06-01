import {execSync} from 'node:child_process'
import {readFileSync, existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_DIR, '../../../../..')

type GateFile = {
    readonly currentPath: string
    readonly committedPath: string
}

const GATE_FILES: readonly GateFile[] = [
    {
        currentPath: 'packages/measures/src/health/coupling/cross-package-coupling.test.ts',
        committedPath: 'packages/systems/cross-package-coupling.test.ts',
    },
    {
        currentPath: 'packages/measures/src/health/complexity/cognitive-complexity.test.ts',
        committedPath: 'packages/systems/cognitive-complexity.test.ts',
    },
    {
        currentPath: 'packages/measures/src/health/purity/purity-ratio-ast.test.ts',
        committedPath: 'packages/measures/src/health/purity/purity-ratio-ast.test.ts',
    },
    {
        currentPath: 'packages/measures/src/health/meta/script-tamper-guard.test.ts',
        committedPath: 'packages/measures/src/health/meta/script-tamper-guard.test.ts',
    },
]

const BUDGET_FILES: readonly string[] = [
    'packages/measures/budgets/coupling/cross-package-value-symbol-budgets.ts',
    'packages/measures/budgets/complexity/cognitive-complexity.json',
    'packages/measures/budgets/purity/purity-ratio-ast.json',
]

const SHARED_FILES: readonly string[] = [
    'packages/measures/src/_shared/graph/call-graph.ts',
    'packages/measures/src/_shared/writers/check-report-writer.ts',
    'packages/measures/src/_shared/complexity/cogcx-scorer.ts',
    'packages/measures/src/_shared/complexity/cyclomatic.ts',
    'packages/measures/src/_shared/discovery/discover-packages.ts',
    'packages/measures/src/_shared/discovery/function-discovery.ts',
    'packages/measures/src/_shared/complexity/function-row-formatters.ts',
    'packages/measures/src/_shared/writers/health-report-writer.ts',
    'packages/measures/src/_shared/complexity/hierarchical-complexity-measures.ts',
    'packages/measures/src/_shared/graph/import-graph.ts',
    'packages/measures/src/_shared/complexity/maintainability.ts',
    'packages/measures/src/_shared/purity-analysis.ts',
    'packages/measures/src/_shared/writers/report-writer.ts',
    'packages/measures/src/_shared/graph/runtime-fan-in.ts',
    'packages/measures/src/_shared/writers/vitest-ci-check-reporter.ts',
    'packages/measures/src/_shared/budgets/read-budget.ts',
]

const RUNNER_FILES: readonly string[] = [
    'packages/measures/src/_runners/capture-ci-checks.ts',
    'packages/measures/src/_runners/record-result.ts',
    'packages/measures/src/_runners/record-run.ts',
    'packages/measures/src/_runners/run-with-xvfb-if-needed.ts',
]

function gitShow(relativePath: string): string | null {
    try {
        return execSync(`git show HEAD:${relativePath}`, {cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']})
    } catch {
        return null
    }
}

function extractRecordBudgets(source: string, pattern: RegExp): Map<string, number> {
    const match = source.match(pattern)
    if (!match) return new Map()

    const block = match[0]
    const entries = new Map<string, number>()
    const entryPattern = /['"](.+?)['"].*?:\s*(\d+)/g
    let m: RegExpExecArray | null
    while ((m = entryPattern.exec(block)) !== null) {
        entries.set(m[1], Number(m[2]))
    }
    return entries
}

function extractNumericConst(source: string, name: string): number | null {
    const match = source.match(new RegExp(`const\\s+${name}\\s*[=:]\\s*(\\d+)`))
    return match ? Number(match[1]) : null
}

function extractJsonField(source: string, field: string): number | null {
    try {
        const parsed = JSON.parse(source) as Record<string, unknown>
        const value = parsed[field]
        return typeof value === 'number' ? value : null
    } catch {
        return null
    }
}

type BudgetCheck = {
    readonly file: string
    readonly key: string
    readonly committed: number
    readonly current: number
}

function checkBudgetsOnlyRatchetDown(
    committed: ReadonlyMap<string, number>,
    current: ReadonlyMap<string, number>,
    file: string,
): BudgetCheck[] {
    const violations: BudgetCheck[] = []

    for (const [key, committedValue] of committed) {
        const currentValue = current.get(key)
        if (currentValue === undefined) continue
        if (currentValue > committedValue) {
            violations.push({file, key, committed: committedValue, current: currentValue})
        }
    }

    return violations
}

describe('gate integrity — budgets only ratchet down', () => {
    it('all gate test files exist on disk', async () => {
        const gateFilePaths = GATE_FILES.map(f => f.currentPath)
        const missing = gateFilePaths.filter(f => !existsSync(resolve(REPO_ROOT, f)))
        await recordHealthMetric({
            metricId: 'gate-files-exist',
            metricName: 'Gate Files Exist',
            description: 'Required budget gate test files missing from disk.',
            category: 'Other',
            current: missing.length,
            budget: 0,
            comparison: 'lte',
            unit: 'files',
            details: {missing, gateFiles: gateFilePaths},
        })
        expect(missing, `Gate files missing: ${missing.join(', ')}`).toEqual([])
    })

    it('all budget data files exist on disk', async () => {
        const missing = BUDGET_FILES.filter(f => !existsSync(resolve(REPO_ROOT, f)))
        await recordHealthMetric({
            metricId: 'budget-files-exist',
            metricName: 'Budget Data Files Exist',
            description: 'Required budget data files missing from disk.',
            category: 'Other',
            current: missing.length,
            budget: 0,
            comparison: 'lte',
            unit: 'files',
            details: {missing, budgetFiles: BUDGET_FILES},
        })
        expect(missing, `Budget files missing: ${missing.join(', ')}`).toEqual([])
    })

    it('all shared and runner support files exist on disk', async () => {
        const supportFiles = [...SHARED_FILES, ...RUNNER_FILES]
        const missing = supportFiles.filter(f => !existsSync(resolve(REPO_ROOT, f)))

        await recordHealthMetric({
            metricId: 'measures-support-files-exist',
            metricName: 'Measures Support Files Exist',
            description: 'Required _shared and _runners files missing from disk.',
            category: 'Other',
            current: missing.length,
            budget: 0,
            comparison: 'lte',
            unit: 'files',
            details: {missing, sharedFiles: SHARED_FILES, runnerFiles: RUNNER_FILES},
        })

        expect(missing, `Measures support files missing: ${missing.join(', ')}`).toEqual([])
    })

    it('coupling budgets have not increased vs committed version', async () => {
        const budgetFile = 'packages/measures/budgets/coupling/cross-package-value-symbol-budgets.ts'
        const committed = gitShow(budgetFile)
        if (!committed) return

        const current = readFileSync(resolve(REPO_ROOT, budgetFile), 'utf8')
        const pattern = /CROSS_PACKAGE_VALUE_SYMBOL_BUDGETS[\s\S]*?\{[\s\S]*?\}/
        const committedBudgets = extractRecordBudgets(committed, pattern)
        const currentBudgets = extractRecordBudgets(current, pattern)
        const violations = checkBudgetsOnlyRatchetDown(committedBudgets, currentBudgets, budgetFile)

        await recordHealthMetric({
            metricId: 'gate-coupling-budget-ratchet',
            metricName: 'Coupling Budget Ratchet',
            description: 'Coupling budgets that increased relative to the committed version.',
            category: 'Other',
            current: violations.length,
            budget: 0,
            comparison: 'lte',
            unit: 'violations',
            details: {violations},
        })

        expect(
            violations.map(v => `${v.key}: ${v.committed} → ${v.current}`),
            `Coupling budgets may only decrease:\n${violations.map(v => `  ${v.key}: was ${v.committed}, now ${v.current}`).join('\n')}`,
        ).toEqual([])
    })

    it('cognitive complexity threshold has not increased vs committed version', async () => {
        const budgetFile = 'packages/measures/budgets/complexity/cognitive-complexity.json'
        const committed = gitShow(budgetFile)
        if (!committed) return

        const current = readFileSync(resolve(REPO_ROOT, budgetFile), 'utf8')

        const committedMax = extractJsonField(committed, 'maxCognitiveComplexity')
        const currentMax = extractJsonField(current, 'maxCognitiveComplexity')

        if (committedMax !== null && currentMax !== null) {
            await recordHealthMetric({
                metricId: 'gate-cognitive-threshold-ratchet',
                metricName: 'Cognitive Threshold Ratchet',
                description: 'Cognitive complexity threshold compared with the committed version.',
                category: 'Other',
                current: currentMax,
                budget: committedMax,
                comparison: 'lte',
                unit: 'score',
                details: {file: budgetFile, committedMax, currentMax},
            })
            expect(currentMax, `maxCognitiveComplexity raised from ${committedMax} to ${currentMax}`).toBeLessThanOrEqual(committedMax)
        }
    })

    it('cognitive complexity baseline budgets have not increased vs committed version', async () => {
        const budgetFile = 'packages/measures/budgets/complexity/cognitive-complexity.json'
        const committed = gitShow(budgetFile)
        if (!committed) return

        const current = readFileSync(resolve(REPO_ROOT, budgetFile), 'utf8')

        function extractBaselineBudgets(source: string): Map<string, number> {
            try {
                const parsed = JSON.parse(source) as {baselineComplexityBudgets?: Record<string, number>}
                const raw = parsed.baselineComplexityBudgets ?? {}
                return new Map(Object.entries(raw).map(([k, v]) => [k, v] as const))
            } catch {
                return new Map()
            }
        }

        const committedBudgets = extractBaselineBudgets(committed)
        const currentBudgets = extractBaselineBudgets(current)
        const violations = checkBudgetsOnlyRatchetDown(committedBudgets, currentBudgets, budgetFile)

        await recordHealthMetric({
            metricId: 'gate-cognitive-baseline-ratchet',
            metricName: 'Cognitive Baseline Ratchet',
            description: 'Per-function cognitive complexity baseline budgets that increased relative to the committed version.',
            category: 'Other',
            current: violations.length,
            budget: 0,
            comparison: 'lte',
            unit: 'violations',
            details: {violations},
        })

        expect(
            violations.map(v => `${v.key}: ${v.committed} → ${v.current}`),
            `Complexity budgets may only decrease:\n${violations.map(v => `  ${v.key}: was ${v.committed}, now ${v.current}`).join('\n')}`,
        ).toEqual([])
    })

    it('purity ratio threshold has not decreased vs committed version', async () => {
        const budgetFile = 'packages/measures/budgets/purity/purity-ratio-ast.json'
        const committed = gitShow(budgetFile)
        if (!committed) return

        const current = readFileSync(resolve(REPO_ROOT, budgetFile), 'utf8')
        const committedMin = extractJsonField(committed, 'minimumPurityRatio')
        const currentMin = extractJsonField(current, 'minimumPurityRatio')

        if (committedMin !== null && currentMin !== null) {
            await recordHealthMetric({
                metricId: 'gate-purity-threshold-ratchet',
                metricName: 'Purity Threshold Ratchet',
                description: 'Purity ratio minimum compared with the committed version.',
                category: 'Other',
                current: currentMin,
                budget: committedMin,
                comparison: 'gte',
                unit: 'ratio',
                details: {file: budgetFile, committedMin, currentMin},
            })
            expect(currentMin, `minimumPurityRatio lowered from ${committedMin} to ${currentMin}`).toBeGreaterThanOrEqual(committedMin)
        }
    })
})
