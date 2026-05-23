import type {FunctionComplexity} from './cyclomatic'
import type {MaintainabilityRow} from './maintainability'

export function formatFunctionRows(rows: readonly FunctionComplexity[]): string {
    return rows.slice(0, 10)
        .map(row => `${row.packageName} | ${row.file}:${row.line} | ${row.name} | cc=${row.score} | crap0=${row.crapZeroCoverage}`)
        .join('\n')
}

export function formatMaintainabilityRows(rows: readonly MaintainabilityRow[]): string {
    return rows.slice(0, 10)
        .map(row => `${row.file} | MI=${row.maintainabilityIndex.toFixed(1)} | volume=${row.volume.toFixed(1)} | fileCC=${row.cyclomatic} | SLOC=${row.sloc}`)
        .join('\n')
}
