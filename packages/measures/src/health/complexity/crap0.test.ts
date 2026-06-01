import {describe, expect, it} from 'vitest'
import {measureCyclomaticComplexity} from '../../_shared/complexity/cyclomatic'
import {discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles} from '../../_shared/discovery/function-discovery'
import {formatFunctionRows} from '../../_shared/complexity/function-row-formatters'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const {maxCoverage: MAX_CRAP_ZERO_COVERAGE} = readBudgetSync<{maxCoverage: number}>('complexity/crap0.json')

describe('function CRAP0 risk health', () => {
    it('keeps CRAP0 risk within budget', async () => {
        const packages = await discoverPackages()
        const files = await discoverSourceFiles(packages)
        const cyclomatic = await measureCyclomaticComplexity(files)
        const maxCrapRows = [...cyclomatic].sort((a, b) => b.crapZeroCoverage - a.crapZeroCoverage || a.file.localeCompare(b.file))
        const maxCrapZeroCoverage = maxCrapRows[0]?.crapZeroCoverage ?? 0

        console.info(`\nTop CRAP0 offenders:\n${formatFunctionRows(maxCrapRows)}`)

        await recordHealthMetric({
            metricId: 'function-crap0-risk',
            metricName: 'Function CRAP0 Risk',
            description: 'Maximum CRAP score estimate per function assuming zero coverage.',
            category: 'Complexity',
            current: maxCrapZeroCoverage,
            budget: MAX_CRAP_ZERO_COVERAGE,
            comparison: 'lte',
            unit: 'score',
            details: {topFunctions: maxCrapRows.slice(0, 20), fileCount: files.length},
        })

        expect.soft(maxCrapZeroCoverage).toBeLessThanOrEqual(MAX_CRAP_ZERO_COVERAGE)
    }, 60000)
})
