// Tiered budgets (Option A from task_ndq4d4):
//
//   budget       = errorBudget — ratchet that gates CI. Calibrated to keep
//                  each axis at debtRatio ≈ 0.75 against today's whole-repo
//                  worst observation, so RSCD ≈ 0.95 ≤ 1.0 with headroom for
//                  small regressions. A fresh worst-offender appearing past
//                  the ratchet breaks the build.
//   targetBudget = aspirational ceiling. Surfaced via the sidecar `-target`
//                  metrics with severity:'warning' (visible on the dashboard,
//                  never blocks CI). Drives gradual refactor work.
export const PRESSURE_AXIS_CONFIGS = [
    {
        name: 'max cognitive complexity',
        metricKey: 'maxCognitiveComplexity',
        metricId: 'complexity-pressure-cognitive-max',
        budget: 140,
        targetBudget: 18,
        comparison: 'lte',
        unit: 'score',
    },
    {
        name: 'max cyclomatic complexity',
        metricKey: 'maxCyclomaticComplexity',
        metricId: 'complexity-pressure-cyclomatic-max',
        budget: 60,
        targetBudget: 20,
        comparison: 'lte',
        unit: 'score',
    },
    // Halstead-MI without SLOC term — target debtRatio for gte axes inverts:
    // errorBudget = current × 0.75 (lower-is-worse → ratchet sits below today's worst).
    {
        name: 'min maintainability index',
        metricKey: 'minMaintainabilityIndex',
        metricId: 'complexity-pressure-maintainability-min',
        budget: 35,
        targetBudget: 60,
        comparison: 'gte',
        unit: 'index',
    },
    {
        name: 'max CRAP0 risk',
        metricKey: 'maxCrapZeroCoverage',
        metricId: 'complexity-pressure-crap0-max',
        budget: 2800,
        targetBudget: 300,
        comparison: 'lte',
        unit: 'score',
    },
    {
        name: 'max file lines',
        metricKey: 'maxFileLines',
        metricId: 'complexity-pressure-file-lines-max',
        budget: 1200,
        targetBudget: 400,
        comparison: 'lte',
        unit: 'lines',
    },
    {
        name: 'max boundary ratio',
        metricKey: 'maxBoundaryRatio',
        metricId: 'complexity-pressure-boundary-ratio-max',
        budget: 0.91,
        targetBudget: 0.30,
        comparison: 'lte',
        unit: 'ratio',
    },
    // Ratio axis: semantic ceiling is 1.0, so 0.75 headroom isn't achievable.
    // Ratchet at 0.95 (tight) — debtRatio ≈ 0.80 today is the load-bearing
    // axis in the RSCD rollup; further widening would defeat the gate.
    {
        name: 'max subdirectory cross-edge ratio',
        metricKey: 'maxSubdirCrossRatio',
        metricId: 'complexity-pressure-subdir-cross-ratio-max',
        budget: 0.95,
        targetBudget: 0.60,
        comparison: 'lte',
        unit: 'ratio',
    },
    {
        name: 'aggregate boundary complexity',
        metricKey: 'aggregateBoundaryComplexity',
        metricId: 'complexity-pressure-boundary-complexity-aggregate',
        budget: 270,
        targetBudget: 16.0,
        comparison: 'lte',
        unit: 'bci',
    },
    {
        name: 'max runtime fan-in',
        metricKey: 'maxRuntimeFanIn',
        metricId: 'complexity-pressure-runtime-fan-in-max',
        budget: 145,
        targetBudget: 10,
        comparison: 'lte',
        unit: 'symbols',
    },
    {
        name: 'max file turbulence',
        metricKey: 'maxFileTurbulence',
        metricId: 'complexity-pressure-file-turbulence-max',
        budget: 1700,
        targetBudget: 250,
        comparison: 'lte',
        unit: 'turbulence',
    },
    {
        name: 'max package avg turbulence',
        metricKey: 'maxPackageAverageTurbulence',
        metricId: 'complexity-pressure-package-turbulence-avg-max',
        budget: 65,
        targetBudget: 35,
        comparison: 'lte',
        unit: 'turbulence',
    },
] as const

export type PressureAxisConfig = typeof PRESSURE_AXIS_CONFIGS[number]
