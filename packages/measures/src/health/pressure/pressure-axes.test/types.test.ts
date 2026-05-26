import type {PressureAxisConfig} from './config.test'

export type SystemFile = {
    readonly absolutePath: string
    readonly relativePath: string
    readonly packageName: string
    readonly npmName: string
    readonly subdirectory: string
}

export type GraphEdge = {
    readonly from: string
    readonly to: string
    readonly fromPackage: string
    readonly toPackage: string
    readonly fromSubdirectory: string
    readonly toSubdirectory: string
}

export type SystemGraph = {
    readonly files: readonly SystemFile[]
    readonly edges: readonly GraphEdge[]
    readonly runtimeSymbolsByTarget: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>
}

export type FunctionComplexity = {
    readonly packageName: string
    readonly file: string
    readonly line: number
    readonly name: string
    readonly score: number
    readonly crapZeroCoverage?: number
}

export type MaintainabilityRow = {
    readonly file: string
    readonly maintainabilityIndex: number
}

export type FileLinesRow = {
    readonly file: string
    readonly lineCount: number
}

export type TurbulenceRow = {
    readonly packageName: string
    readonly file: string
    readonly churn: number
    readonly complexity: number
    readonly turbulence: number
}

export type PressureAxis = {
    readonly name: string
    readonly metricKey: PressureAxisConfig['metricKey']
    readonly current: number
    readonly budget: number
    readonly targetBudget: number
    readonly comparison: 'lte' | 'gte'
    readonly passed: boolean
    readonly debtRatio: number
    readonly worstOffender: string
}
