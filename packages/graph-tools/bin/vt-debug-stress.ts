#!/usr/bin/env npx tsx

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadProjection, loadSnapshot, type State } from '@vt/graph-state'

import { filterLive, pickInstance, readInstancesDir, type DebugInstance } from '../src/debug/discover'
import { computeDrift, type DriftReport } from '../src/debug/drift'
import { err, ok } from '../src/debug/Response'
import type { Response } from '../src/debug/Response'
import { createScoreboard, type FlowScoreboard, type ScoreboardRow } from '../src/debug/scoreboard'
import {
  createDivergenceClassBaseline,
  classifyDriftReport,
  type DivergenceClassBaseline,
} from '../src/debug/stress/divergenceClass'
import {
  DEFAULT_STRESS_SEED,
  DEFAULT_STRESS_SEQUENCE_LENGTH,
  RECORDED_STATE_FIXTURE_IDS,
  deriveStressRuntimeContext,
  generateStressSequence,
  resolveStressSequence,
} from '../src/debug/stress/stressSpec'
import { elementSpecToCyDump, projectStateToCyDump } from '../src/debug/projectedCyDump'
import type { JudgeVerdict } from '../src/debug/judge'
import type { RunResult } from '../src/commands/run'

const DEFAULT_OUT_DIR = '/tmp/vt-debug/stress'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_RESULT_OUT = path.resolve(SCRIPT_DIR, '../fixtures/w4a-result.json')
const DEFAULT_DIVERGENCE_BASELINE = path.resolve(
  SCRIPT_DIR,
  '../fixtures/divergence-class-baseline.json',
)
const DEFAULT_FLOW_BASELINE = path.resolve(SCRIPT_DIR, '../fixtures/int1-baseline.json')
const VT_DEBUG_BIN = path.resolve(SCRIPT_DIR, './vt-debug.ts')
const VT_DEBUG_FLOWS_BIN = path.resolve(SCRIPT_DIR, './vt-debug-flows.ts')
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..')

type RunnerOptions = {
  outDir: string
  resultOut: string
  divergenceBaselinePath: string
  flowBaselinePath: string
  sequenceCount: number
  sequenceLength: number
  seed: number
  writeBaseline: boolean
  skipFlows: boolean
  port?: number
  pid?: number
  vault?: string
}

type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number
  error?: string
}

type RecordedFixtureResult = {
  fixtureId: string
  projectionVsRenderedEqual: boolean
  classIds: string[]
  report: DriftReport
}

type LiveSequenceResult = {
  sequenceId: string
  seed: number
  runDir: string
  stepCount: number
  observedStepCount: number
  projectionVsRenderedEqualSteps: number
  projectionVsRenderedEqual: boolean
  failedSteps: number
  observationErrorCount: number
  classIds: string[]
  error?: string
}

type StressResult = {
  recordedFixtures: RecordedFixtureResult[]
  liveSequences: LiveSequenceResult[]
  observedClassIds: string[]
}

function usage(message?: string): Response<never> {
  return err(
    'stress',
    message ?? 'usage: vt-debug-stress [--out <dir>] [--result-out <file>] [--baseline <file>] [--flow-baseline <file>] [--sequences <n>] [--sequence-length <n>] [--seed <n>] [--write-baseline] [--skip-flows] [--port <n> | --pid <n> | --vault <path>]',
  )
}

function readFlagValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parseNumber(flag: string, value: string | undefined): number {
  const parsed = Number.parseInt(readFlagValue(flag, value), 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires an integer`)
  }
  return parsed
}

function parseArgs(argv: string[]): RunnerOptions | Response<never> {
  let outDir = DEFAULT_OUT_DIR
  let resultOut = DEFAULT_RESULT_OUT
  let divergenceBaselinePath = DEFAULT_DIVERGENCE_BASELINE
  let flowBaselinePath = DEFAULT_FLOW_BASELINE
  let sequenceCount = 200
  let sequenceLength = DEFAULT_STRESS_SEQUENCE_LENGTH
  let seed = DEFAULT_STRESS_SEED
  let writeBaseline = false
  let skipFlows = false
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined

  try {
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index]

      if (arg === '--out') {
        outDir = path.resolve(readFlagValue('--out', argv[index + 1]))
        index += 1
        continue
      }
      if (arg.startsWith('--out=')) {
        outDir = path.resolve(readFlagValue('--out', arg.slice('--out='.length)))
        continue
      }
      if (arg === '--result-out') {
        resultOut = path.resolve(readFlagValue('--result-out', argv[index + 1]))
        index += 1
        continue
      }
      if (arg.startsWith('--result-out=')) {
        resultOut = path.resolve(readFlagValue('--result-out', arg.slice('--result-out='.length)))
        continue
      }
      if (arg === '--baseline') {
        divergenceBaselinePath = path.resolve(readFlagValue('--baseline', argv[index + 1]))
        index += 1
        continue
      }
      if (arg.startsWith('--baseline=')) {
        divergenceBaselinePath = path.resolve(readFlagValue('--baseline', arg.slice('--baseline='.length)))
        continue
      }
      if (arg === '--flow-baseline') {
        flowBaselinePath = path.resolve(readFlagValue('--flow-baseline', argv[index + 1]))
        index += 1
        continue
      }
      if (arg.startsWith('--flow-baseline=')) {
        flowBaselinePath = path.resolve(readFlagValue('--flow-baseline', arg.slice('--flow-baseline='.length)))
        continue
      }
      if (arg === '--sequences') {
        sequenceCount = parseNumber('--sequences', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--sequences=')) {
        sequenceCount = parseNumber('--sequences', arg.slice('--sequences='.length))
        continue
      }
      if (arg === '--sequence-length') {
        sequenceLength = parseNumber('--sequence-length', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--sequence-length=')) {
        sequenceLength = parseNumber('--sequence-length', arg.slice('--sequence-length='.length))
        continue
      }
      if (arg === '--seed') {
        seed = parseNumber('--seed', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--seed=')) {
        seed = parseNumber('--seed', arg.slice('--seed='.length))
        continue
      }
      if (arg === '--write-baseline') {
        writeBaseline = true
        continue
      }
      if (arg === '--skip-flows') {
        skipFlows = true
        continue
      }
      if (arg === '--port') {
        port = parseNumber('--port', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--port=')) {
        port = parseNumber('--port', arg.slice('--port='.length))
        continue
      }
      if (arg === '--pid') {
        pid = parseNumber('--pid', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--pid=')) {
        pid = parseNumber('--pid', arg.slice('--pid='.length))
        continue
      }
      if (arg === '--vault') {
        vault = readFlagValue('--vault', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--vault=')) {
        vault = readFlagValue('--vault', arg.slice('--vault='.length))
        continue
      }

      return usage(`unknown argument: ${arg}`)
    }
  } catch (error) {
    return usage(String(error))
  }

  if (sequenceCount < 1) {
    return usage('--sequences must be >= 1')
  }
  if (sequenceLength < 1) {
    return usage('--sequence-length must be >= 1')
  }

  return {
    outDir,
    resultOut,
    divergenceBaselinePath,
    flowBaselinePath,
    sequenceCount,
    sequenceLength,
    seed,
    writeBaseline,
    skipFlows,
    port,
    pid,
    vault,
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
}

async function execFileResult(args: readonly string[]): Promise<ExecResult> {
  return new Promise(resolve => {
    execFile(
      process.execPath,
      args,
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode = error && typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : 0

        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode,
          ...(error ? { error: error.message } : {}),
        })
      },
    )
  })
}

async function resolveTargetInstance(options: RunnerOptions): Promise<DebugInstance | Response<never>> {
  const all = await readInstancesDir()
  const live = await filterLive(all)
  const pick = pickInstance(live, {
    port: options.port,
    pid: options.pid,
    vault: options.vault,
  })

  if (!pick.ok) {
    return err('stress', pick.message, pick.hint, 2)
  }

  return pick.instance
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function uniqueSorted(values: readonly string[]): string[] {
  return sortStrings([...new Set(values)])
}

function childRunArgs(specPath: string, outDir: string, instance: DebugInstance): string[] {
  return [
    '--import',
    'tsx',
    VT_DEBUG_BIN,
    'run',
    specPath,
    '--drift-each',
    '--stop-on-error=false',
    '--out',
    outDir,
    '--pid',
    String(instance.pid),
  ]
}

function childFlowArgs(outDir: string, fixtureOut: string, instance: DebugInstance): string[] {
  return [
    '--import',
    'tsx',
    VT_DEBUG_FLOWS_BIN,
    'run-all',
    '--out',
    outDir,
    '--fixture-out',
    fixtureOut,
    '--pid',
    String(instance.pid),
  ]
}

function parseResponse<T>(stdout: string): Response<T> | null {
  const trimmed = stdout.trim()
  if (trimmed === '') return null

  const candidates = [trimmed, ...trimmed.split('\n').map(line => line.trim()).filter(Boolean).slice(-1)]
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as Response<T>
    } catch {
      // Try the next candidate.
    }
  }

  return null
}

function snapshotFsContentById(state: State): Record<string, string> {
  return Object.fromEntries(
    Object.entries(state.graph.nodes).map(([nodeId, node]) => [nodeId, node.contentWithoutYamlOrLinks]),
  )
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Number(((numerator / denominator) * 100).toFixed(2))
}

function pad(index: number): string {
  return String(index).padStart(3, '0')
}

async function runRecordedFixtureReplay(): Promise<RecordedFixtureResult[]> {
  const results: RecordedFixtureResult[] = []

  for (const fixtureId of RECORDED_STATE_FIXTURE_IDS) {
    const state = loadSnapshot(fixtureId)
    const expectedProjection = loadProjection(fixtureId)
    const report = computeDrift(
      {
        ...state,
        fsContentById: snapshotFsContentById(state),
      },
      projectStateToCyDump(state),
      elementSpecToCyDump(expectedProjection, state),
    )

    results.push({
      fixtureId,
      projectionVsRenderedEqual: report.projectionVsRendered.equal,
      classIds: classifyDriftReport(report),
      report,
    })
  }

  return results
}

async function runLiveStress(
  options: RunnerOptions,
  instance: DebugInstance,
): Promise<LiveSequenceResult[]> {
  const transportModule = await import('../src/liveTransport')
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

function collectObservedClassIds(stress: StressResult): string[] {
  return uniqueSorted([
    ...stress.recordedFixtures.flatMap(result => result.classIds),
    ...stress.liveSequences.flatMap(result => result.classIds),
  ])
}

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

async function runFlowScoreboard(
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

async function loadBaseline(
  baselinePath: string,
  observedClassIds: readonly string[],
  writeBaseline: boolean,
): Promise<DivergenceClassBaseline> {
  if (writeBaseline) {
    const baseline = createDivergenceClassBaseline(observedClassIds)
    await writeJson(baselinePath, baseline)
    return baseline
  }

  return readJson<DivergenceClassBaseline>(baselinePath)
}

async function handler(argv: string[]): Promise<Response<unknown>> {
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

const result = await handler(process.argv.slice(2))
process.stdout.write(JSON.stringify(result) + '\n')
process.exit(result.ok ? 0 : result.exitCode ?? 1)
