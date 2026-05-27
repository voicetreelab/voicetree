import { FLOW_IDS, loadAllFlowDefinitions, loadFlowDefinition } from '../../src/debug/flow/flows/index'
import {
  computeGate,
  type FlowScoreboard,
} from '../../src/debug/flow/scoreboard'
import { ok } from '../../src/debug/protocol/Response'
import type { Response } from '../../src/debug/protocol/Response'

import { parseArgs } from './args'
import { runFlowSet } from './flowExecution'
import { resolveTargetInstance } from './targetInstance'
import type { RunAllResult } from './types'

export async function handler(argv: string[]): Promise<Response<unknown>> {
  const parsed = parseArgs(argv)
  if ('ok' in parsed) {
    return parsed
  }

  if (parsed.command === 'list') {
    const flows = await loadAllFlowDefinitions()
    return ok('flows', {
      flowIds: FLOW_IDS,
      flows: flows.map(flow => ({
        flow: flow.flow,
        title: flow.title,
        likelyStatusToday: flow.likelyStatusToday,
        stepCount: flow.steps.length,
      })),
    })
  }

  const instance = await resolveTargetInstance(parsed.options)
  if ('ok' in instance) {
    return instance
  }

  if (parsed.command === 'run') {
    const definition = await loadFlowDefinition(parsed.flowId)
    const result = await runFlowSet([definition], parsed.options, instance)
    return ok('flows', result)
  }

  const definitions = await loadAllFlowDefinitions()
  const result = await runFlowSet(definitions, parsed.options, instance)
  return ok('flows', result)
}

function isRunAllResult(value: unknown): value is RunAllResult {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.scoreboardPath === 'string'
    && typeof record.baselineWritten === 'boolean'
    && typeof record.scoreboard === 'object'
    && record.scoreboard !== null
}

function printScoreboardSummary(scoreboard: FlowScoreboard): void {
  const totalFlows = scoreboard.perFlow.length
  process.stdout.write(
    `semanticPass: ${scoreboard.semanticPassCount}/${totalFlows} threshold=${scoreboard.semanticPassThreshold} gate=${scoreboard.gate}\n`,
  )
  process.stdout.write(`mechanicalPass: ${scoreboard.mechanicalPassCount}/${totalFlows}\n`)
}

export function printRunAllSummary(result: Response<unknown>): void {
  if (result.ok && isRunAllResult(result.result)) {
    printScoreboardSummary(result.result.scoreboard)
  }
}

export function exitCodeForResult(result: Response<unknown>): number {
  if (!result.ok) {
    return result.exitCode ?? 1
  }

  return isRunAllResult(result.result) && computeGate(
    result.result.scoreboard.semanticPassCount,
    result.result.scoreboard.semanticPassThreshold,
  ) === 'FAIL'
    ? 1
    : 0
}
