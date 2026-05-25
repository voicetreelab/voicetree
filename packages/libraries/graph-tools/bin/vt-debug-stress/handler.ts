import fs from 'node:fs/promises'

import { ok } from '../../src/debug/protocol/Response'
import type { Response } from '../../src/debug/protocol/Response'
import { RECORDED_STATE_FIXTURE_IDS } from '../../src/debug/stress/stressSpec'

import { parseArgs } from './args'
import { loadBaseline } from './baseline'
import { runFlowScoreboard } from './flowScoreboard'
import { writeJson } from './io'
import { collectObservedClassIds, runLiveStress } from './liveStress'
import { percent } from './math'
import { runRecordedFixtureReplay } from './recordedFixtures'
import { resolveTargetInstance } from './targetInstance'
import type { StressResult } from './types'

export async function handler(argv: string[]): Promise<Response<unknown>> {
  const options = parseArgs(argv)
  if ('ok' in options && options.ok === false) {
    return options
  }

  const instance = await resolveTargetInstance(options)
  if ('ok' in instance && instance.ok === false) {
    return instance
  }

  await fs.mkdir(options.outDir, { recursive: true })

  const recordedFixtures = await runRecordedFixtureReplay()
  const liveSequences = await runLiveStress(options, instance)
  const stress = {
    recordedFixtures,
    liveSequences,
    observedClassIds: [],
  } satisfies StressResult
  stress.observedClassIds = collectObservedClassIds(stress)

  const baseline = await loadBaseline(
    options.divergenceBaselinePath,
    stress.observedClassIds,
    options.writeBaseline,
  )
  const newClassIds = stress.observedClassIds.filter(id => !baseline.classIds.includes(id))

  const recordedProjectionEqualCount = recordedFixtures.filter(
    result => result.projectionVsRenderedEqual,
  ).length
  const liveEqualSequenceCount = liveSequences.filter(result => result.projectionVsRenderedEqual).length
  const liveFailedSequenceCount = liveSequences.filter(
    result => result.error !== undefined
      || result.failedSteps > 0
      || result.observationErrorCount > 0
      || result.observedStepCount !== result.stepCount,
  ).length
  const liveObservedStepCount = liveSequences.reduce(
    (sum, result) => sum + result.observedStepCount,
    0,
  )
  const liveEqualStepCount = liveSequences.reduce(
    (sum, result) => sum + result.projectionVsRenderedEqualSteps,
    0,
  )

  let flowScoreboard: Awaited<ReturnType<typeof runFlowScoreboard>> | null = null
  let flowError: string | null = null
  if (!options.skipFlows) {
    try {
      flowScoreboard = await runFlowScoreboard(options, instance)
    } catch (error) {
      flowError = error instanceof Error ? error.message : String(error)
    }
  }

  const gateReasons: string[] = []
  if (newClassIds.length > 0) {
    gateReasons.push(`new divergence classes: ${newClassIds.join(', ')}`)
  }
  if (percent(liveEqualSequenceCount, liveSequences.length) < 99) {
    gateReasons.push(
      `projectionVsRendered.equal sequence rate ${percent(liveEqualSequenceCount, liveSequences.length)}% < 99%`,
    )
  }
  if (liveFailedSequenceCount > 0) {
    gateReasons.push(`${liveFailedSequenceCount} live stress sequences had step failures or missing drift observations`)
  }
  if (flowError) {
    gateReasons.push(`flow scoreboard failed: ${flowError}`)
  }
  if (flowScoreboard && !flowScoreboard.comparison.monotonicNonDecreasing) {
    gateReasons.push(
      `flow scoreboard regressed: ${flowScoreboard.comparison.regressions.join(', ') || 'pass count decreased'}`,
    )
  }

  const result = {
    generatedAt: new Date().toISOString(),
    config: {
      sequenceCount: options.sequenceCount,
      sequenceLength: options.sequenceLength,
      seed: options.seed,
      recordedFixtures: RECORDED_STATE_FIXTURE_IDS,
      outDir: options.outDir,
      divergenceBaselinePath: options.divergenceBaselinePath,
      flowBaselinePath: options.flowBaselinePath,
    },
    divergenceClasses: {
      observedCount: stress.observedClassIds.length,
      observedClassIds: stress.observedClassIds,
      baselineCount: baseline.classIds.length,
      baselineClassIds: baseline.classIds,
      newClassIds,
    },
    recordedFixtures: {
      total: recordedFixtures.length,
      projectionVsRenderedEqualCount: recordedProjectionEqualCount,
      projectionVsRenderedEqualPct: percent(recordedProjectionEqualCount, recordedFixtures.length),
      results: recordedFixtures,
    },
    liveSequences: {
      total: liveSequences.length,
      projectionVsRenderedEqualSequenceCount: liveEqualSequenceCount,
      projectionVsRenderedEqualSequencePct: percent(liveEqualSequenceCount, liveSequences.length),
      projectionVsRenderedEqualStepCount: liveEqualStepCount,
      projectionVsRenderedEqualStepPct: percent(liveEqualStepCount, liveObservedStepCount),
      failedSequenceCount: liveFailedSequenceCount,
      results: liveSequences,
    },
    flowScoreboard: flowScoreboard
      ? {
          baselineSemanticPassCount: flowScoreboard.comparison.baselineSemanticPassCount,
          currentSemanticPassCount: flowScoreboard.comparison.currentSemanticPassCount,
          semanticPassCountDelta: flowScoreboard.comparison.semanticPassCountDelta,
          regressions: flowScoreboard.comparison.regressions,
          improvements: flowScoreboard.comparison.improvements,
          monotonicNonDecreasing: flowScoreboard.comparison.monotonicNonDecreasing,
          baselinePerFlow: flowScoreboard.baseline.perFlow,
          currentPerFlow: flowScoreboard.current.perFlow,
          currentScoreboardPath: flowScoreboard.currentScoreboardPath,
        }
      : {
          error: flowError ?? 'flow scoreboard skipped',
          skipped: options.skipFlows,
        },
    gate: {
      pass: gateReasons.length === 0,
      reasons: gateReasons,
    },
  }

  await writeJson(options.resultOut, result)

  return ok('stress', {
    resultPath: options.resultOut,
    baselinePath: options.divergenceBaselinePath,
    pass: gateReasons.length === 0,
    gateReasons,
    divergenceClassCount: stress.observedClassIds.length,
    projectionVsRenderedEqualSequencePct: percent(liveEqualSequenceCount, liveSequences.length),
    projectionVsRenderedEqualStepPct: percent(liveEqualStepCount, liveObservedStepCount),
    flowScoreboardDelta: flowScoreboard?.comparison.semanticPassCountDelta ?? null,
  })
}
