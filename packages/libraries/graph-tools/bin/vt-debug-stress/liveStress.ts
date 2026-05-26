import fs from 'node:fs/promises'
import path from 'node:path'

import type { DebugInstance } from '../../src/debug/protocol/discover'
import type { DriftReport } from '../../src/debug/state/drift'
import { classifyDriftReport } from '../../src/debug/stress/divergenceClass'
import {
  deriveStressRuntimeContext,
  generateStressSequence,
  resolveStressSequence,
} from '../../src/debug/stress/stressSpec'
import type { RunTypes } from '../../src/commands/capture/run/types'

import { readJson, writeJson } from './io'
import { pad, uniqueSorted } from './math'
import { childRunArgs, execFileResult, parseResponse } from './process'
import type { LiveSequenceResult, RunnerOptions, StressResult } from './types'

type RunResult = RunTypes['RunResult']

export async function runLiveStress(
  options: RunnerOptions,
  instance: DebugInstance,
): Promise<LiveSequenceResult[]> {
  const transportModule = await import('../../src/live/liveTransport')
  const transport = transportModule.createLiveTransport(instance.mcpPort)
  const initialState = await transport.getLiveState()
  const runtimeContext = deriveStressRuntimeContext(initialState)
  const liveOutDir = path.join(options.outDir, 'live')

  await fs.mkdir(liveOutDir, { recursive: true })

  const results: LiveSequenceResult[] = []

  for (let index = 0; index < options.sequenceCount; index += 1) {
    const sequenceSeed = options.seed + index
    const rawSteps = generateStressSequence(options.sequenceLength, sequenceSeed)
    const resolvedSteps = resolveStressSequence(rawSteps, runtimeContext)
    const sequenceId = `sequence-${pad(index + 1)}`
    const sequenceDir = path.join(liveOutDir, sequenceId)
    const specPath = path.join(sequenceDir, 'stress-sequence.json')

    await fs.mkdir(sequenceDir, { recursive: true })
    await writeJson(specPath, resolvedSteps)

    const execResult = await execFileResult(childRunArgs(specPath, sequenceDir, instance))
    await writeJson(path.join(sequenceDir, 'cli-result.json'), execResult)

    const parsed = parseResponse<RunResult>(execResult.stdout)
    if (!parsed) {
      results.push({
        sequenceId,
        seed: sequenceSeed,
        runDir: sequenceDir,
        stepCount: resolvedSteps.length,
        observedStepCount: 0,
        projectionVsRenderedEqualSteps: 0,
        projectionVsRenderedEqual: false,
        failedSteps: resolvedSteps.length,
        observationErrorCount: 0,
        classIds: [],
        error: execResult.stderr.trim() || execResult.error || 'vt-debug run returned non-JSON output',
      })
      continue
    }

    if (!parsed.ok) {
      results.push({
        sequenceId,
        seed: sequenceSeed,
        runDir: sequenceDir,
        stepCount: resolvedSteps.length,
        observedStepCount: 0,
        projectionVsRenderedEqualSteps: 0,
        projectionVsRenderedEqual: false,
        failedSteps: resolvedSteps.length,
        observationErrorCount: 0,
        classIds: [],
        error: parsed.error,
      })
      continue
    }

    const reports: DriftReport[] = []
    let observationErrorCount = 0
    let failedSteps = 0

    for (const output of parsed.result.bundle.outputs) {
      if (!output.ok) {
        failedSteps += 1
      }
      observationErrorCount += output.observationErrors?.length ?? 0
      if (!output.drift) {
        continue
      }
      try {
        reports.push(await readJson<DriftReport>(output.drift))
      } catch {
        observationErrorCount += 1
      }
    }

    const classIds = uniqueSorted(reports.flatMap(report => classifyDriftReport(report)))
    const projectionVsRenderedEqualSteps = reports.filter(
      report => report.projectionVsRendered.equal,
    ).length

    results.push({
      sequenceId,
      seed: sequenceSeed,
      runDir: sequenceDir,
      stepCount: parsed.result.bundle.stepCount,
      observedStepCount: reports.length,
      projectionVsRenderedEqualSteps,
      projectionVsRenderedEqual:
        reports.length === parsed.result.bundle.stepCount
        && projectionVsRenderedEqualSteps === reports.length,
      failedSteps,
      observationErrorCount,
      classIds,
    })
  }

  return results
}

export function collectObservedClassIds(stress: StressResult): string[] {
  return uniqueSorted([
    ...stress.recordedFixtures.flatMap(result => result.classIds),
    ...stress.liveSequences.flatMap(result => result.classIds),
  ])
}
