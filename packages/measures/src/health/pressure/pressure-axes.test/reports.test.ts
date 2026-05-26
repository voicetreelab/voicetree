import {recordHealthMetric, removeHealthReports} from '../../../_shared/writers/report-writer'
import {PRESSURE_AXIS_CONFIGS} from './config.test'
import type {PressureAxis} from './types.test'

// Sidecar `-target` metrics surface each axis's aspirational targetBudget
// alongside the CI-gating errorBudget. severity:'warning' keeps them off the
// CI gate while marking the corresponding dashboard tile as off-target. Lets
// reviewers track refactor pressure on individual axes without holding up
// merges.
async function recordSidecarTargets(axes: readonly PressureAxis[]): Promise<void> {
    for (const axisData of axes) {
        const config = PRESSURE_AXIS_CONFIGS.find(c => c.name === axisData.name)
        if (!config) continue
        if (config.budget === config.targetBudget) continue
        await recordHealthMetric({
            metricId: `${config.metricId}-target`,
            metricName: `${config.name} (aspirational target)`,
            description: `Warning-only sidecar for ${config.name}. Reports the axis value against the aspirational target budget rather than the CI-gating ratchet. Never blocks CI.`,
            category: 'Complexity',
            current: axisData.current,
            budget: config.targetBudget,
            comparison: config.comparison,
            severity: 'warning',
            unit: config.unit,
            details: {
                errorBudget: config.budget,
                targetBudget: config.targetBudget,
                worstOffender: axisData.worstOffender,
            },
        })
    }
}

async function removeRetiredLegacyPressureReports(): Promise<void> {
    await removeHealthReports(PRESSURE_AXIS_CONFIGS.map(config => config.metricId))
}

export async function recordPressureAxisReports(
    axes: readonly PressureAxis[],
    rscd: number,
    topFiveRatiosForRscd: readonly number[],
): Promise<void> {
    const failingAxes = axes.filter(axis => !axis.passed).map(axis => axis.name)

    await removeRetiredLegacyPressureReports()
    await recordHealthMetric({
        metricId: 'pressure-axes',
        metricName: 'Complexity Pressure Axes',
        description: 'Consolidated 10-axis complexity-pressure rollup',
        category: 'Complexity',
        current: rscd,
        budget: 1.0,
        comparison: 'lte',
        unit: 'rscd',
        details: {axes, failingAxes, topFiveRatiosForRscd, rscd},
    })
    await recordSidecarTargets(axes)
}
