import {describe, expect, it} from 'vitest'
import {measureCyclomaticComplexity} from '../../_shared/complexity/cyclomatic'
import {discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles} from '../../_shared/discovery/function-discovery'
import {formatFunctionRows} from '../../_shared/complexity/function-row-formatters'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const {max: MAX_CYCLOMATIC_COMPLEXITY} = readBudgetSync<{max: number}>('complexity/cyclomatic-complexity.json')

describe('function cyclomatic complexity health', () => {
    it('keeps cyclomatic complexity within budget', async () => {
        const packages = await discoverPackages()
        const files = await discoverSourceFiles(packages)
        const cyclomatic = await measureCyclomaticComplexity(files)
        const maxCyclomatic = cyclomatic[0]?.score ?? 0

        console.info(`\nTop cyclomatic offenders:\n${formatFunctionRows(cyclomatic)}`)

        await recordHealthMetric({
            metricId: 'function-cyclomatic-complexity',
            metricName: 'Function Cyclomatic Complexity',
            description: 'Maximum per-function cyclomatic complexity across discovered production packages.',
            category: 'Complexity',
            current: maxCyclomatic,
            budget: MAX_CYCLOMATIC_COMPLEXITY,
            comparison: 'lte',
            unit: 'branches',
            details: {topFunctions: cyclomatic.slice(0, 20), fileCount: files.length},
        })

        expect.soft(maxCyclomatic).toBeLessThanOrEqual(MAX_CYCLOMATIC_COMPLEXITY)
    }, 60000)
})
