import { execFile } from 'node:child_process'

import { type DebugInstance } from '../../src/debug/protocol/discover'
import type { Response } from '../../src/debug/protocol/Response'
import type { RunTypes } from '../../src/commands/capture/run/types'

import { OBSERVATION_FLAGS, REPO_ROOT, VT_DEBUG_BIN } from './paths'
import type { ExecResult } from './types'

type RunResult = RunTypes['RunResult']

export async function execFileResult(args: readonly string[]): Promise<ExecResult> {
  return new Promise(resolve => {
    execFile(
      process.execPath,
      args,
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
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

export function childRunArgs(specPath: string, outDir: string, instance: DebugInstance): string[] {
  return [
    '--import',
    'tsx',
    VT_DEBUG_BIN,
    'run',
    specPath,
    ...OBSERVATION_FLAGS,
    '--out',
    outDir,
    '--pid',
    String(instance.pid),
  ]
}

export function parseRunResponse(stdout: string): Response<RunResult> | null {
  if (stdout.trim() === '') return null
  try {
    return JSON.parse(stdout) as Response<RunResult>
  } catch {
    return null
  }
}
