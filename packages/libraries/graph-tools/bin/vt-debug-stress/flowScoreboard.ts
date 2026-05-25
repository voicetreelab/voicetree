import fs from 'node:fs/promises'
import path from 'node:path'

import type { DebugInstance } from '../../src/debug/protocol/discover'
import type { JudgeVerdict } from '../../src/debug/flow/judge'
import { createScoreboard, type FlowScoreboard, type ScoreboardRow } from '../../src/debug/flow/scoreboard'

import { readJson, writeJson } from './io'
import { uniqueSorted } from './math'
import { childFlowArgs, execFileResult, parseResponse } from './process'
import type { RunnerOptions } from './types'

type LegacyFlowScoreboard = {
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

type LegacyJudgeVerdict = JudgeVerdict & {
  readonly flow: string
}

function isLegacyFlowScoreboard(value: unknown): value is LegacyFlowScoreboard {
  return typeof value === 'object'
    && value !== null
    && Array.isArray((value as { rows?: unknown }).rows)
    && typeof (value as { bundleDirs?: unknown }).bundleDirs === 'object'
    && (value as { bundleDirs?: unknown }).bundleDirs !== null
}

function normalizeLegacyFlowScoreboard(
  scoreboard: LegacyFlowScoreboard,
  judgeVerdicts: readonly LegacyJudgeVerdict[] = [],
): FlowScoreboard {
  const semanticVerdicts = new Map<string, JudgeVerdict>(
    judgeVerdicts.map(verdict => [
      verdict.flow,
      {
        pass: verdict.pass,
        per_step: verdict.per_step,
        overall_reason: verdict.overall_reason,
      },
    ]),
  )

  const normalized = createScoreboard(scoreboard.rows, scoreboard.bundleDirs, {
    semanticPassThreshold: 0,
    semanticVerdicts,
  })

  return {
    ...normalized,
    generatedAt: scoreboard.generatedAt,
    pre_registered_baseline: scoreboard.pre_registered_baseline,
    runConfig: scoreboard.runConfig,
    status: scoreboard.status,
    note: scoreboard.note,
  }
}

function isFlowScoreboard(value: unknown): value is FlowScoreboard {
  return typeof value === 'object'
    && value !== null
    && Array.isArray((value as { perFlow?: unknown }).perFlow)
    && typeof (value as { semanticPassCount?: unknown }).semanticPassCount === 'number'
    && typeof (value as { semanticPassThreshold?: unknown }).semanticPassThreshold === 'number'
}

function extractScoreboard(value: unknown): FlowScoreboard {
  if (isFlowScoreboard(value)) {
    return value
  }

  if (isLegacyFlowScoreboard(value)) {
    return normalizeLegacyFlowScoreboard(value)
  }

  const nested = value as {
    harness_run?: { scoreboard?: unknown }
    judge_verdicts?: unknown
  }

  if (isFlowScoreboard(nested.harness_run?.scoreboard)) {
    return nested.harness_run.scoreboard
  }

  if (isLegacyFlowScoreboard(nested.harness_run?.scoreboard)) {
    const judgeVerdicts = Array.isArray(nested.judge_verdicts)
      ? nested.judge_verdicts.filter(
        (entry): entry is LegacyJudgeVerdict =>
          typeof entry === 'object'
          && entry !== null
          && typeof (entry as { flow?: unknown }).flow === 'string',
      )
      : []
    return normalizeLegacyFlowScoreboard(nested.harness_run.scoreboard, judgeVerdicts)
  }

  throw new Error('unable to extract a flow scoreboard from the baseline file')
}

function compareScoreboards(baseline: FlowScoreboard, current: FlowScoreboard) {
  const baselineRows = new Map(baseline.perFlow.map(row => [row.flow, row] as const))
  const currentRows = new Map(current.perFlow.map(row => [row.flow, row] as const))
  const flowIds = uniqueSorted([...baselineRows.keys(), ...currentRows.keys()])
  const regressions: string[] = []
  const improvements: string[] = []

  for (const flowId of flowIds) {
    const baselineRow = baselineRows.get(flowId)
    const currentRow = currentRows.get(flowId)

    if (baselineRow?.semantic.pass === true && currentRow?.semantic.pass !== true) {
      regressions.push(flowId)
    }
    if (baselineRow?.semantic.pass !== true && currentRow?.semantic.pass === true) {
      improvements.push(flowId)
    }
  }

  const baselineSemanticPassCount = baseline.semanticPassCount
  const currentSemanticPassCount = current.semanticPassCount

  return {
    baselineSemanticPassCount,
    currentSemanticPassCount,
    semanticPassCountDelta: currentSemanticPassCount - baselineSemanticPassCount,
    regressions,
    improvements,
    monotonicNonDecreasing:
      regressions.length === 0
      && currentSemanticPassCount >= baselineSemanticPassCount,
  }
}

export async function runFlowScoreboard(
  options: RunnerOptions,
  instance: DebugInstance,
): Promise<{
  baseline: FlowScoreboard
  current: FlowScoreboard
  currentScoreboardPath: string
  comparison: ReturnType<typeof compareScoreboards>
}> {
  const baseline = extractScoreboard(await readJson<unknown>(options.flowBaselinePath))
  const flowsOutDir = path.join(options.outDir, 'flows')
  const fixtureOut = path.join(flowsOutDir, 'scoreboard-current.json')

  await fs.mkdir(flowsOutDir, { recursive: true })

  const execResult = await execFileResult(childFlowArgs(flowsOutDir, fixtureOut, instance))
  await writeJson(path.join(flowsOutDir, 'cli-result.json'), execResult)

  const parsed = parseResponse<{
    scoreboard: FlowScoreboard
    scoreboardPath: string
    fixturePath: string
  }>(execResult.stdout)

  if (!parsed) {
    throw new Error(execResult.stderr.trim() || execResult.error || 'vt-debug-flows returned non-JSON output')
  }
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }

  return {
    baseline,
    current: parsed.result.scoreboard,
    currentScoreboardPath: parsed.result.scoreboardPath,
    comparison: compareScoreboards(baseline, parsed.result.scoreboard),
  }
}
