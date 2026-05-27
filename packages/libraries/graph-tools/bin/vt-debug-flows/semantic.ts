import fs from 'node:fs/promises'
import path from 'node:path'

import { type FlowId } from '../../src/debug/flow/flows/index'
import { parseJudgeResponse, type JudgeVerdict } from '../../src/debug/flow/judge'

import { readJsonSafe } from './io'

function extractSemanticPassThreshold(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>
  if (typeof record.semanticPassThreshold === 'number') {
    return record.semanticPassThreshold
  }

  const harnessRun = record.harness_run
  if (typeof harnessRun !== 'object' || harnessRun === null) {
    return null
  }

  const scoreboard = (harnessRun as { scoreboard?: unknown }).scoreboard
  if (typeof scoreboard !== 'object' || scoreboard === null) {
    return null
  }

  return typeof (scoreboard as { semanticPassThreshold?: unknown }).semanticPassThreshold === 'number'
    ? (scoreboard as { semanticPassThreshold: number }).semanticPassThreshold
    : null
}

export async function loadSemanticPassThreshold(fixtureOut: string): Promise<number> {
  const existingFixture = await readJsonSafe<unknown>(fixtureOut)
  return extractSemanticPassThreshold(existingFixture) ?? 0
}

export async function loadSemanticVerdicts(flowIds: readonly FlowId[], outDir: string): Promise<Map<string, JudgeVerdict>> {
  const semanticVerdicts = new Map<string, JudgeVerdict>()
  const verdictDir = path.resolve(outDir)

  for (const flowId of flowIds) {
    const verdictPath = path.join(verdictDir, `judge-${flowId}.json`)
    try {
      const raw = await fs.readFile(verdictPath, 'utf8')
      semanticVerdicts.set(flowId, parseJudgeResponse(raw))
    } catch {
      // No colocated semantic verdict for this run yet.
    }
  }

  return semanticVerdicts
}
