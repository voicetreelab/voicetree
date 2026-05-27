import fs from 'node:fs/promises'
import path from 'node:path'

import { type DebugInstance } from '../../src/debug/protocol/discover'
import {
  deriveFlowRuntimeContext,
  resolveFlowDefinition,
  type FlowDefinition,
} from '../../src/debug/flow/flows/index'
import {
  buildScoreboardRow,
  createScoreboard,
  evaluateRunResult,
  type FlowAttempt,
} from '../../src/debug/flow/scoreboard'
import { createLiveTransport } from '../../src/live/liveTransport'
import { waitForLiveStateWithRoots } from '../../src/debug/protocol/waitForLiveRoots'

import { loadSemanticPassThreshold, loadSemanticVerdicts } from './semantic'
import { childRunArgs, execFileResult, parseRunResponse } from './process'
import { writeJson } from './io'
import type { RunAllResult, RunnerOptions } from './types'

function flowTimestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '')
}

async function executeFlowAttempt(
  definition: FlowDefinition,
  flowDir: string,
  runIndex: number,
  instance: DebugInstance,
): Promise<FlowAttempt> {
  const runDir = path.join(flowDir, `run-${String(runIndex).padStart(2, '0')}`)
  await fs.mkdir(runDir, { recursive: true })

  try {
    const transport = createLiveTransport(instance.mcpPort)
    const state = await waitForLiveStateWithRoots(transport)
    const context = deriveFlowRuntimeContext(state)
    const resolved = resolveFlowDefinition(definition, context)
    const specPath = path.join(runDir, 'flow.json')
    await writeJson(specPath, resolved)

    const execResult = await execFileResult(childRunArgs(specPath, runDir, instance))
    await writeJson(path.join(runDir, 'cli-result.json'), execResult)

    const parsed = parseRunResponse(execResult.stdout)
    if (!parsed) {
      return {
        pass: false,
        reason: execResult.stderr.trim() || execResult.error || 'vt-debug run returned non-JSON output',
        bundleDir: runDir,
      }
    }

    const attempt = evaluateRunResult(parsed)
    return {
      ...attempt,
      bundleDir: attempt.bundleDir || runDir,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeJson(path.join(runDir, 'resolution-error.json'), { error: message })
    return {
      pass: false,
      reason: message,
      bundleDir: runDir,
    }
  }
}

async function executeFlow(
  definition: FlowDefinition,
  options: RunnerOptions,
  instance: DebugInstance,
  timestamp: string,
): Promise<{ row: ReturnType<typeof buildScoreboardRow>; bundleDir: string }> {
  const flowDir = path.join(options.outDir, `${definition.flow}-${timestamp}`)
  await fs.mkdir(flowDir, { recursive: true })
  await writeJson(path.join(flowDir, 'flow-definition.json'), definition)

  const attempts: FlowAttempt[] = []
  for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
    attempts.push(await executeFlowAttempt(definition, flowDir, runIndex, instance))
  }

  const row = buildScoreboardRow(definition.flow, attempts)
  await writeJson(path.join(flowDir, 'scoreboard-row.json'), row)

  return { row, bundleDir: flowDir }
}

export async function runFlowSet(
  definitions: readonly FlowDefinition[],
  options: RunnerOptions,
  instance: DebugInstance,
): Promise<RunAllResult> {
  await fs.mkdir(options.outDir, { recursive: true })

  const timestamp = flowTimestamp()
  const rows: ReturnType<typeof buildScoreboardRow>[] = []
  const bundleDirs: Record<string, string> = {}

  for (const definition of definitions) {
    const result = await executeFlow(definition, options, instance, timestamp)
    rows.push(result.row)
    bundleDirs[definition.flow] = result.bundleDir
  }

  const semanticPassThreshold = await loadSemanticPassThreshold(options.fixtureOut)
  const semanticVerdicts = await loadSemanticVerdicts(
    definitions.map(definition => definition.flow),
    options.outDir,
  )
  const scoreboard = createScoreboard(rows, bundleDirs, {
    semanticPassThreshold,
    semanticVerdicts,
  })
  const scoreboardPath = path.join(options.outDir, `scoreboard-${timestamp}.json`)
  await writeJson(scoreboardPath, scoreboard)

  if (options.writeBaseline) {
    await writeJson(options.fixtureOut, scoreboard)
  }

  return {
    scoreboard,
    scoreboardPath,
    fixturePath: options.writeBaseline ? options.fixtureOut : null,
    baselineWritten: options.writeBaseline,
  }
}
