import {describe, expect, it} from 'vitest'
import {measureCyclomaticComplexity} from '../../_shared/cyclomatic'
import {discoverPackages} from '../../_shared/discover-packages'
import {discoverSourceFiles} from '../../_shared/function-discovery'
import {formatFunctionRows} from '../../_shared/function-row-formatters'
import {recordHealthMetric} from '../../_shared/report-writer'

// Captured 2026-05-15 after widening discovery to whole repo via discoverPackages(); ratchet down over time.
const MAX_CRAP_ZERO_COVERAGE = 2500    // observed max: 2070 (same offender as cyclomatic); ratchet down

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
