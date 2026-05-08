import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  PRE_REGISTERED_BASELINE,
  buildScoreboardRow,
  createScoreboard,
  evaluateRunResult,
} from '../src/debug/scoreboard'
import type { JudgeVerdict } from '../src/debug/judge'

const testDir = path.dirname(fileURLToPath(import.meta.url))

describe('scoreboard helpers', () => {
  const passingJudgeVerdict: JudgeVerdict = {
    pass: true,
    per_step: [{ step: 1, pass: true, reason: 'semantic pass' }],
    overall_reason: 'semantic pass',
  }

  it('treats a full green bundle as a passing attempt', () => {
    const attempt = evaluateRunResult({
      ok: true,
      command: 'run',
      result: {
        source: 'flow.json',
        bundle: {
          dir: '/tmp/run-1',
          stepCount: 2,
          outputs: [
            { step: { wait: 1 }, ok: true },
            { step: { wait: 2 }, ok: true },
          ],
        },
      },
    })

    expect(attempt).toEqual({
      pass: true,
      reason: 'all 2 steps passed',
      bundleDir: '/tmp/run-1',
    })
  })

  it('fails attempts that stop early or emit observation errors', () => {
    expect(
      evaluateRunResult({
        ok: true,
        command: 'run',
        result: {
          source: 'flow.json',
          bundle: {
            dir: '/tmp/run-2',
            stepCount: 2,
            outputs: [
              { step: { wait: 1 }, ok: true },
            ],
          },
        },
      }),
    ).toEqual({
      pass: false,
      reason: 'stopped after 1/2 steps',
      bundleDir: '/tmp/run-2',
    })

    expect(
      evaluateRunResult({
        ok: true,
        command: 'run',
        result: {
          source: 'flow.json',
          bundle: {
            dir: '/tmp/run-3',
            stepCount: 1,
            outputs: [
              {
                step: { wait: 1 },
                ok: true,
                observationErrors: ['state: unavailable'],
              },
            ],
          },
        },
      }),
    ).toEqual({
      pass: false,
      reason: 'step 1 observation errors: state: unavailable',
      bundleDir: '/tmp/run-3',
    })
  })

  it('marks flows green on majority pass and preserves the preregistered baseline', () => {
    const row = buildScoreboardRow('F2', [
      { pass: true, reason: 'run 1 ok', bundleDir: '/tmp/F2-1' },
      { pass: false, reason: 'run 2 failed', bundleDir: '/tmp/F2-2' },
      { pass: true, reason: 'run 3 ok', bundleDir: '/tmp/F2-3' },
    ])

    expect(row).toEqual({
      flow: 'F2',
      pass: true,
      reason: '2/3 runs passed',
      runs: [true, false, true],
    })

    const scoreboard = createScoreboard([row], { F2: '/tmp/F2' }, {
      semanticPassThreshold: 1,
      semanticVerdicts: new Map([['F2', passingJudgeVerdict]]),
    })
    expect(scoreboard.pre_registered_baseline).toBe(PRE_REGISTERED_BASELINE)
    expect(scoreboard.runConfig.judgeFlakeRuns).toBe(3)
    expect(scoreboard.semanticPassCount).toBe(1)
    expect(scoreboard.semanticPassThreshold).toBe(1)
    expect(scoreboard.mechanicalPassCount).toBe(1)
    expect(scoreboard.gate).toBe('PASS')
  })

  it('ships a semantic-first baseline fixture with preserved judge verdicts', () => {
    const fixturePath = path.resolve(testDir, '../fixtures/int1-baseline.json')
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      semanticPassCount: number
      semanticPassThreshold: number
      mechanicalPassCount: number
      pre_registered_baseline: string
      runConfig: { judgeFlakeRuns: number }
      perFlow: Array<{
        flow: string
        semantic: {
          judgeVerdict: JudgeVerdict | null
        }
      }>
      legacy: {
        mechanicalPass: number
      }
    }

    expect(fixture.pre_registered_baseline).toBe(PRE_REGISTERED_BASELINE)
    expect(fixture.runConfig.judgeFlakeRuns).toBe(3)
    expect(fixture.semanticPassCount).toBe(0)
    expect(fixture.semanticPassThreshold).toBe(0)
    expect(fixture.mechanicalPassCount).toBe(7)
    expect(fixture.legacy.mechanicalPass).toBe(7)
    expect(fixture.perFlow).toHaveLength(8)
    expect(fixture.perFlow.every(flow => flow.semantic.judgeVerdict !== null)).toBe(true)
  })
})
