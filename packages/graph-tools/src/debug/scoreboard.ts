import type { Response } from './Response'
import type { RunResult, RunStepOutput } from '../commands/run'

export const PRE_REGISTERED_BASELINE = '≤3/8 pass (Ayu prediction B, conf 0.75)'
export const JUDGE_FLAKE_RUNS = 3

export interface FlowAttempt {
  readonly pass: boolean
  readonly reason: string
  readonly bundleDir: string
}

export interface ScoreboardRow {
  readonly flow: string
  readonly pass: boolean
  readonly reason: string
  readonly runs: readonly boolean[]
}

export interface FlowScoreboard {
  readonly generatedAt: string | null
  readonly pre_registered_baseline: string
  readonly runConfig: {
    readonly judgeFlakeRuns: number
    readonly observationFlags: readonly string[]
  }
  readonly rows: readonly ScoreboardRow[]
  readonly bundleDirs: Record<string, string>
  readonly status?: 'pending-live-run'
  readonly note?: string
}

function firstFailure(outputs: readonly RunStepOutput[]): string | null {
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index]
    if (!output.ok) {
      return `step ${index + 1} failed: ${output.error ?? 'unknown error'}`
    }
    if ((output.observationErrors?.length ?? 0) > 0) {
      return `step ${index + 1} observation errors: ${output.observationErrors?.join('; ')}`
    }
  }
  return null
}

export function evaluateRunResult(result: Response<RunResult>): FlowAttempt {
  if (!result.ok) {
    return {
      pass: false,
      reason: `vt-debug run failed: ${result.error}`,
      bundleDir: '',
    }
  }

  const bundle = result.result.bundle
  const failure = firstFailure(bundle.outputs)
  if (failure) {
    return {
      pass: false,
      reason: failure,
      bundleDir: bundle.dir,
    }
  }

  if (bundle.outputs.length !== bundle.stepCount) {
    return {
      pass: false,
      reason: `stopped after ${bundle.outputs.length}/${bundle.stepCount} steps`,
      bundleDir: bundle.dir,
    }
  }

  return {
    pass: true,
    reason: `all ${bundle.stepCount} steps passed`,
    bundleDir: bundle.dir,
  }
}

export function buildScoreboardRow(flow: string, attempts: readonly FlowAttempt[]): ScoreboardRow {
  const runs = attempts.map(attempt => attempt.pass)
  const passCount = runs.filter(Boolean).length
  const majorityPassed = passCount >= Math.ceil(runs.length / 2)

  if (majorityPassed) {
    return {
      flow,
      pass: true,
      reason: `${passCount}/${runs.length} runs passed`,
      runs,
    }
  }

  const firstFailureReason = attempts.find(attempt => !attempt.pass)?.reason ?? 'no passing runs'
  return {
    flow,
    pass: false,
    reason: `${passCount}/${runs.length} runs passed; ${firstFailureReason}`,
    runs,
  }
}

export function createScoreboard(
  rows: readonly ScoreboardRow[],
  bundleDirs: Record<string, string>,
): FlowScoreboard {
  return {
    generatedAt: new Date().toISOString(),
    pre_registered_baseline: PRE_REGISTERED_BASELINE,
    runConfig: {
      judgeFlakeRuns: JUDGE_FLAKE_RUNS,
      observationFlags: ['--screenshot-each', '--console-each', '--state-each', '--stop-on-error=false'],
    },
    rows,
    bundleDirs,
  }
}

export function createPendingBaseline(note: string): FlowScoreboard {
  return {
    generatedAt: null,
    pre_registered_baseline: PRE_REGISTERED_BASELINE,
    runConfig: {
      judgeFlakeRuns: JUDGE_FLAKE_RUNS,
      observationFlags: ['--screenshot-each', '--console-each', '--state-each', '--stop-on-error=false'],
    },
    rows: [],
    bundleDirs: {},
    status: 'pending-live-run',
    note,
  }
}
