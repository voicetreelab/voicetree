import {describe, expect, it} from 'vitest'
import {measureCyclomaticComplexity} from '../../_shared/cyclomatic'
import {discoverPackages} from '../../_shared/discover-packages'
import {discoverSourceFiles} from '../../_shared/function-discovery'
import {formatFunctionRows} from '../../_shared/function-row-formatters'
import {recordHealthMetric} from '../../_shared/report-writer'

// Captured 2026-05-15 after widening discovery to whole repo via discoverPackages(); ratchet down over time.
const MAX_CYCLOMATIC_COMPLEXITY = 50   // observed max: 45 (graph-model/folderCollapse.ts:computeExpandPlan)

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
