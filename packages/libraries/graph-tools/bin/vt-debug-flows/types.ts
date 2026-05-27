import type { FlowId } from '../../src/debug/flow/flows/index'
import type { FlowScoreboard } from '../../src/debug/flow/scoreboard'

export type RunnerOptions = {
  outDir: string
  fixtureOut: string
  writeBaseline: boolean
  port?: number
  pid?: number
  vault?: string
}

export type ParsedArgs =
  | { command: 'list'; options: RunnerOptions }
  | { command: 'run-all'; options: RunnerOptions }
  | { command: 'run'; flowId: FlowId; options: RunnerOptions }

export type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number
  error?: string
}

export type RunAllResult = {
  scoreboard: FlowScoreboard
  scoreboardPath: string
  fixturePath: string | null
  baselineWritten: boolean
}
