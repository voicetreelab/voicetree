import {execSync} from 'node:child_process'
import {readFileSync, existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {recordHealthMetric} from './_health-report-test-helpers'

const SYSTEMS_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')

const GATE_FILES: readonly string[] = [
    'packages/systems/cross-package-coupling.test.ts',
    'packages/systems/cognitive-complexity.test.ts',
    'packages/systems/purity-ratio-ast.test.ts',
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

function extractMapBudgets(source: string, pattern: RegExp): Map<string, number> {
    const match = source.match(pattern)
    if (!match) return new Map()

    const block = match[0]
    const entries = new Map<string, number>()
    const entryPattern = /\['(.+?)',\s*(\d+)\]/g
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
        const missing = GATE_FILES.filter(f => !existsSync(resolve(REPO_ROOT, f)))
        await recordHealthMetric({
            metricId: 'gate-files-exist',
            metricName: 'Gate Files Exist',
            description: 'Required budget gate test files missing from disk.',
            category: 'Other',
            current: missing.length,
            budget: 0,
            comparison: 'lte',
            unit: 'files',
            details: {missing, gateFiles: GATE_FILES},
        })
        expect(missing, `Gate files missing: ${missing.join(', ')}`).toEqual([])
    })

    it('coupling budgets have not increased vs committed version', async () => {
        const file = 'packages/systems/cross-package-coupling.test.ts'
        const committed = gitShow(file)
        if (!committed) return

        const current = readFileSync(resolve(REPO_ROOT, file), 'utf8')
        const pattern = /COUPLING_BUDGET[\s\S]*?\{[\s\S]*?\}/
        const committedBudgets = extractRecordBudgets(committed, pattern)
        const currentBudgets = extractRecordBudgets(current, pattern)
        const violations = checkBudgetsOnlyRatchetDown(committedBudgets, currentBudgets, file)

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
        const file = 'packages/systems/cognitive-complexity.test.ts'
        const committed = gitShow(file)
        if (!committed) return

        const current = readFileSync(resolve(REPO_ROOT, file), 'utf8')

        const committedMax = extractNumericConst(committed, 'MAX_COGNITIVE_COMPLEXITY')
        const currentMax = extractNumericConst(current, 'MAX_COGNITIVE_COMPLEXITY')

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
                details: {file, committedMax, currentMax},
            })
            expect(currentMax, `MAX_COGNITIVE_COMPLEXITY raised from ${committedMax} to ${currentMax}`).toBeLessThanOrEqual(committedMax)
        }
    })

    it('cognitive complexity baseline budgets have not increased vs committed version', async () => {
        const file = 'packages/systems/cognitive-complexity.test.ts'
        const committed = gitShow(file)
        if (!committed) return

        const current = readFileSync(resolve(REPO_ROOT, file), 'utf8')
        const pattern = /BASELINE_COMPLEXITY_BUDGETS[\s\S]*?new Map\(\[[\s\S]*?\]\)/
        const committedBudgets = extractMapBudgets(committed, pattern)
        const currentBudgets = extractMapBudgets(current, pattern)
        const violations = checkBudgetsOnlyRatchetDown(committedBudgets, currentBudgets, file)

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
        const file = 'packages/systems/purity-ratio-ast.test.ts'
        const committed = gitShow(file)
        if (!committed) return

        const current = readFileSync(resolve(REPO_ROOT, file), 'utf8')
        const committedMin = extractNumericConst(committed, 'MIN_PURITY_PERCENT')
        const currentMin = extractNumericConst(current, 'MIN_PURITY_PERCENT')

        if (committedMin !== null && currentMin !== null) {
            await recordHealthMetric({
                metricId: 'gate-purity-threshold-ratchet',
                metricName: 'Purity Threshold Ratchet',
                description: 'Purity ratio minimum compared with the committed version.',
                category: 'Other',
                current: currentMin,
                budget: committedMin,
                comparison: 'gte',
                unit: 'percent',
                details: {file, committedMin, currentMin},
            })
            expect(currentMin, `MIN_PURITY_PERCENT lowered from ${committedMin} to ${currentMin}`).toBeGreaterThanOrEqual(committedMin)
        }
    })
})
