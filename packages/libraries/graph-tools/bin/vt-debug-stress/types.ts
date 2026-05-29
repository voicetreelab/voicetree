import type { DriftReport } from '../../src/debug/state/drift'

export type RunnerOptions = {
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
  project?: string
}

export type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number
  error?: string
}

export type RecordedFixtureResult = {
  fixtureId: string
  projectionVsRenderedEqual: boolean
  classIds: string[]
  report: DriftReport
}

export type LiveSequenceResult = {
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

export type StressResult = {
  recordedFixtures: RecordedFixtureResult[]
  liveSequences: LiveSequenceResult[]
  observedClassIds: string[]
}
