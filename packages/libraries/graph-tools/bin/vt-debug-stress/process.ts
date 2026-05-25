import { execFile } from 'node:child_process'

import type { DebugInstance } from '../../src/debug/protocol/discover'
import type { Response } from '../../src/debug/protocol/Response'

import { REPO_ROOT, VT_DEBUG_BIN, VT_DEBUG_FLOWS_BIN } from './paths'
import type { ExecResult } from './types'

export async function execFileResult(args: readonly string[]): Promise<ExecResult> {
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

export function childRunArgs(specPath: string, outDir: string, instance: DebugInstance): string[] {
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

export function childFlowArgs(outDir: string, fixtureOut: string, instance: DebugInstance): string[] {
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

export function parseResponse<T>(stdout: string): Response<T> | null {
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
