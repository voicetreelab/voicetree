import {discoverPackages} from '../../../_shared/discovery/discover-packages'
import {measureBoundaries, runtimeFanInRows} from './boundaries.test'
import {PRESSURE_AXIS_CONFIGS, type PressureAxisConfig} from './config.test'
import {measureFileLines} from './file-lines.test'
import {measureCognitiveComplexity, measureCyclomaticComplexity} from './function-complexity.test'
import {buildSystemGraph} from './graph.test'
import {measureMaintainability} from './maintainability.test'
import {REPO_ROOT} from './repo-root.test'
import {aggregateTurbulence, measureTurbulence} from './turbulence.test'
import type {PressureAxis} from './types.test'
export type {PressureAxis} from './types.test'
export {recordPressureAxisReports} from './reports.test'

function debtRatio(current: number, budget: number, comparison: PressureAxis['comparison']): number {
    return comparison === 'gte' ? budget / Math.max(1, current) : budget === 0 ? 0 : current / budget
}

function axisPassed(current: number, budget: number, comparison: PressureAxis['comparison']): boolean {
    return comparison === 'gte' ? current >= budget : current <= budget
}

function axis(config: PressureAxisConfig, current: number, worstOffender: string): PressureAxis {
    return {
        name: config.name,
        metricKey: config.metricKey,
        current,
        budget: config.budget,
        targetBudget: config.targetBudget,
        comparison: config.comparison,
        passed: axisPassed(current, config.budget, config.comparison),
        debtRatio: debtRatio(current, config.budget, config.comparison),
        worstOffender,
    }
}

export async function computePressureAxes(): Promise<PressureAxis[]> {
    const packages = await discoverPackages(REPO_ROOT)
    const packageNames = packages.map(pkg => pkg.dirName)
    const graph = await buildSystemGraph(packages)

    const cognitive = await measureCognitiveComplexity(graph.files)
    const cyclomatic = await measureCyclomaticComplexity(graph.files)
    const maintainability = await measureMaintainability(graph.files, cyclomatic)
    const fileLines = await measureFileLines(graph.files)
    const turbulence = await measureTurbulence(graph.files)
    const packageTurbulence = aggregateTurbulence(turbulence)
    const boundaries = measureBoundaries(graph.files, graph.edges, packageNames)
    const runtimeFanIn = runtimeFanInRows(graph.runtimeSymbolsByTarget)
    const maxCrap = [...cyclomatic].sort((a, b) => b.crapZeroCoverage - a.crapZeroCoverage)[0]

    return [
        axis(PRESSURE_AXIS_CONFIGS[0], cognitive[0]?.score ?? 0, cognitive[0] ? `${cognitive[0].file}:${cognitive[0].line} ${cognitive[0].name}` : 'n/a'),
        axis(PRESSURE_AXIS_CONFIGS[1], cyclomatic[0]?.score ?? 0, cyclomatic[0] ? `${cyclomatic[0].file}:${cyclomatic[0].line} ${cyclomatic[0].name}` : 'n/a'),
        axis(PRESSURE_AXIS_CONFIGS[2], maintainability[0]?.maintainabilityIndex ?? 100, maintainability[0]?.file ?? 'n/a'),
        axis(PRESSURE_AXIS_CONFIGS[3], maxCrap?.crapZeroCoverage ?? 0, maxCrap ? `${maxCrap.file}:${maxCrap.line} ${maxCrap.name}` : 'n/a'),
        axis(PRESSURE_AXIS_CONFIGS[4], fileLines[0]?.lineCount ?? 0, fileLines[0]?.file ?? 'n/a'),
        axis(PRESSURE_AXIS_CONFIGS[5], boundaries.boundaryProfiles[0]?.ratio ?? 0, boundaries.boundaryProfiles[0]?.packageName ?? 'n/a'),
        axis(PRESSURE_AXIS_CONFIGS[6], boundaries.subdirProfiles[0]?.ratio ?? 0, boundaries.subdirProfiles[0]?.packageName ?? 'n/a'),
        axis(PRESSURE_AXIS_CONFIGS[7], boundaries.aggregateBci, boundaries.pairMetrics[0]?.pair ?? 'n/a'),
        axis(PRESSURE_AXIS_CONFIGS[8], runtimeFanIn[0]?.runtimeSymbols ?? 0, runtimeFanIn[0]?.packageName ?? 'n/a'),
        axis(PRESSURE_AXIS_CONFIGS[9], turbulence[0]?.turbulence ?? 0, turbulence[0]?.file ?? 'n/a'),
        axis(PRESSURE_AXIS_CONFIGS[10], packageTurbulence[0]?.average ?? 0, packageTurbulence[0]?.packageName ?? 'n/a'),
    ]
}

export function computeRscd(axes: readonly PressureAxis[]): {rscd: number; topFiveRatiosForRscd: number[]} {
    const topFiveRatiosForRscd = axes.map(axis => axis.debtRatio).sort((a, b) => b - a).slice(0, 5)
    const meanTopFive = topFiveRatiosForRscd.reduce((sum, value) => sum + value, 0) / Math.max(1, topFiveRatiosForRscd.length)
    return {rscd: (topFiveRatiosForRscd[0] ?? 0) + 0.25 * meanTopFive, topFiveRatiosForRscd}
}

export function failureMessage(axes: readonly PressureAxis[], rscd: number): string {
    return [
        `RSCD ${rscd} exceeds target 1.0.`,
        ...axes.filter(axis => !axis.passed).map(axis => `${axis.name}: current=${axis.current}, budget=${axis.budget}, debtRatio=${axis.debtRatio}, offender=${axis.worstOffender}`),
    ].join('\n')
}
