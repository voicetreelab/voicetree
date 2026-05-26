import {describe, expect, it} from 'vitest'
import {
    computePressureAxes,
    computeRscd,
    failureMessage,
    recordPressureAxisReports,
} from './pressure-axes.test/pressure-axes.test'

describe('complexity pressure axes', () => {
    it('records the calibrated pressure rollup using whole-repo axis semantics', async () => {
        const axes = await computePressureAxes()
        const {rscd, topFiveRatiosForRscd} = computeRscd(axes)
        const message = failureMessage(axes, rscd)

        await recordPressureAxisReports(axes, rscd, topFiveRatiosForRscd)

        for (const pressureAxis of axes) {
            if (pressureAxis.comparison === 'gte') {
                expect.soft(pressureAxis.current, message).toBeGreaterThanOrEqual(pressureAxis.budget)
            } else {
                expect.soft(pressureAxis.current, message).toBeLessThanOrEqual(pressureAxis.budget)
            }
        }
        expect(rscd, message).toBeLessThanOrEqual(1.0)
    }, 120000)
})
