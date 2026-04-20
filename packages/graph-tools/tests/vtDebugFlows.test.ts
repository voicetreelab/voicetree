import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(testDir, '../../..')

describe('vt-debug-flows CLI', () => {
  it('lists the authored flow library without requiring a live Electron instance', () => {
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', 'packages/graph-tools/bin/vt-debug-flows.ts', 'list'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    )

    const parsed = JSON.parse(stdout) as {
      ok: boolean
      result: {
        flowIds: string[]
        flows: Array<{ flow: string; stepCount: number }>
      }
    }

    expect(parsed.ok).toBe(true)
    expect(parsed.result.flowIds).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'])
    expect(parsed.result.flows.every(flow => flow.stepCount > 0)).toBe(true)
  })
})
