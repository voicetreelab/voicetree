import { describe, expect, it } from 'vitest'

import type { JudgeVerdict } from '../src/debug/judge'
import { createScoreboard, type ScoreboardRow } from '../src/debug/scoreboard'

function makeRows(): { rows: ScoreboardRow[]; bundleDirs: Record<string, string> } {
  const rows: ScoreboardRow[] = []
  const bundleDirs: Record<string, string> = {}

  for (let index = 1; index <= 8; index += 1) {
    const flow = `F${index}`
    rows.push({
      flow,
      pass: true,
      reason: '3/3 runs passed',
      runs: [true, true, true],
    })
    bundleDirs[flow] = `/tmp/${flow}`
  }

  return { rows, bundleDirs }
}

function verdict(pass: boolean): JudgeVerdict {
  return {
    pass,
    per_step: [{ step: 1, pass, reason: pass ? 'semantic pass' : 'semantic fail' }],
    overall_reason: pass ? 'semantic pass' : 'semantic fail',
  }
}

describe('INT-1 semantic gate', () => {
  it('passes when semantic results meet the threshold', () => {
    const { rows, bundleDirs } = makeRows()
    const semanticVerdicts = new Map<string, JudgeVerdict>([
      ['F1', verdict(true)],
      ['F2', verdict(true)],
      ['F3', verdict(true)],
      ['F4', verdict(false)],
      ['F5', verdict(false)],
      ['F6', verdict(false)],
      ['F7', verdict(false)],
      ['F8', verdict(false)],
    ])

    const scoreboard = createScoreboard(rows, bundleDirs, {
      semanticPassThreshold: 1,
      semanticVerdicts,
    })

    expect(scoreboard.semanticPassCount).toBe(3)
    expect(scoreboard.gate).toBe('PASS')
  })

  it('fails when semantic results fall below the threshold', () => {
    const { rows, bundleDirs } = makeRows()
    const semanticVerdicts = new Map<string, JudgeVerdict>([
      ['F1', verdict(false)],
      ['F2', verdict(false)],
      ['F3', verdict(false)],
      ['F4', verdict(false)],
      ['F5', verdict(false)],
      ['F6', verdict(false)],
      ['F7', verdict(false)],
      ['F8', verdict(false)],
    ])

    const scoreboard = createScoreboard(rows, bundleDirs, {
      semanticPassThreshold: 1,
      semanticVerdicts,
    })

    expect(scoreboard.semanticPassCount).toBe(0)
    expect(scoreboard.gate).toBe('FAIL')
  })
})
