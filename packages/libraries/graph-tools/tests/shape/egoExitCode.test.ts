/**
 * REC 5 — exit-code wiring for `vt-graph live focus|neighbors|path`.
 *
 * `emitEgoRender` is the shell-edge function that turns an EgoRender into an
 * observable CLI effect: where the text is written (stdout vs stderr) and the
 * process exit code. A typo'd / unknown node id ('not-found') must exit
 * NON-zero and write to stderr, while a genuine disconnected-pair ('no-path')
 * and a normal result ('ok') exit 0 and write to stdout.
 *
 * Black-box: feed each EgoRender kind, assert on the real stream writes and
 * `process.exitCode`. No internal mocking — we observe the actual side effects.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { emitEgoRender, EGO_NOT_FOUND_EXIT_CODE } from '../../bin/vt-graph/commands/live'

type Captured = { stdout: string; stderr: string }

function captureStreams(fn: () => void): Captured {
  const captured: Captured = { stdout: '', stderr: '' }
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  const origLog = console.log
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    captured.stdout += typeof chunk === 'string' ? chunk : chunk.toString()
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    captured.stderr += typeof chunk === 'string' ? chunk : chunk.toString()
    return true
  }) as typeof process.stderr.write
  // console.log routes through process.stdout but capturing it explicitly keeps
  // the assertion independent of Node's internal newline handling.
  console.log = (...args: unknown[]): void => {
    captured.stdout += `${args.join(' ')}\n`
  }
  try {
    fn()
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
    console.log = origLog
  }
  return captured
}

describe('emitEgoRender', () => {
  afterEach(() => {
    // emitEgoRender sets process.exitCode for the not-found case; reset so a
    // non-zero code does not leak into the test runner's own exit.
    process.exitCode = 0
  })

  it("'ok' writes to stdout and leaves exit code 0", () => {
    const out = captureStreams(() => emitEgoRender({ kind: 'ok', text: 'a.md → b.md' }))
    expect(out.stdout).toContain('a.md → b.md')
    expect(out.stderr).toBe('')
    expect(process.exitCode ?? 0).toBe(0)
  })

  it("genuine 'no-path' writes to stdout and exits 0 (valid result, not an error)", () => {
    const out = captureStreams(() => emitEgoRender({ kind: 'no-path', text: 'no path from a.md to d.md' }))
    expect(out.stdout).toContain('no path')
    expect(out.stderr).toBe('')
    expect(process.exitCode ?? 0).toBe(0)
  })

  it("'not-found' (typo) writes to stderr and sets a NON-zero, distinct exit code", () => {
    const out = captureStreams(() => emitEgoRender({ kind: 'not-found', text: 'node not found: typo.md' }))
    expect(out.stderr).toContain('not found')
    expect(out.stdout).toBe('')
    expect(process.exitCode).toBe(EGO_NOT_FOUND_EXIT_CODE)
    expect(EGO_NOT_FOUND_EXIT_CODE).not.toBe(0)
  })
})
