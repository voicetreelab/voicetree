#!/usr/bin/env node
/**
 * Child-process helper for the BF-348 cross-process storm regression test.
 *
 * Invoked as:
 *   node --import tsx <this> --project-root <path> --bin "<command line>"
 *     [--timeoutMs <n>] [--caller <CallerKind>]
 *
 * Calls `ensureGraphDaemonForProject` once and writes a single JSON line to
 * stdout describing the outcome:
 *
 *   { "ok": true, "port": N, "pid": P, "ownerNonce": "...", "launched": true|false }
 *   { "ok": false, "errorName": "...", "errorMessage": "..." }
 *
 * Exits 0 on success, 1 on any thrown error. The test harness reads the
 * JSON line back to verify all child processes converged on the same owner.
 *
 * Note: the `.mjs` extension is a misnomer — this file uses TS-only syntax
 * because the harness re-uses it through `node --import tsx`. Kept under
 * fixtures/ alongside fake-vt-graphd.mjs so vitest does not treat it as a
 * test file.
 */

import { ensureGraphDaemonForProject } from '@vt/graph-db-client'

function arg(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const project = arg('--project-root')
const bin = arg('--bin')
const timeoutMs = Number(arg('--timeoutMs') ?? '10000')
const caller = arg('--caller') ?? 'electron'

if (!project || !bin) {
  process.stderr.write('ensure-graphd-child: --project-root and --bin required\n')
  process.exit(2)
}

try {
  const result = await ensureGraphDaemonForProject(project, caller, {
    bin,
    timeoutMs,
  })
  process.stdout.write(
    JSON.stringify({
      ok: true,
      port: result.port,
      pid: result.pid,
      ownerNonce: result.ownerNonce,
      launched: result.launched,
    }) + '\n',
  )
  process.exit(0)
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      errorName: err?.name ?? 'Error',
      errorMessage: err?.message ?? String(err),
    }) + '\n',
  )
  process.exit(1)
}
