#!/usr/bin/env node
/**
 * Child-process helper for the BF-374 cross-process storm regression test.
 *
 * Invoked as:
 *   node --import tsx <this> --vault <path> --bin "<command line>"
 *     [--timeoutMs <n>] [--caller <CallerKind>]
 *
 * Calls `ensureVtDaemonForVault` once and writes a single JSON line to
 * stdout describing the outcome:
 *
 *   { "ok": true, "port": N, "pid": P, "ownerNonce": "...",
 *     "authToken": "...", "launched": true|false }
 *   { "ok": false, "errorName": "...", "errorMessage": "..." }
 *
 * Exits 0 on success, 1 on any thrown error. The test harness reads the
 * JSON line back to verify all child processes converged on the same VTD
 * owner.
 *
 * Mirrors `ensure-graphd-child.mjs` but parses `--vault` (NOT
 * `--project-root`) and imports from `@vt/vt-daemon-client`. The argv
 * flag is intentionally distinct: a misconfigured launcher must fail
 * loudly at parseArgs rather than silently route to the wrong daemon.
 *
 * Note: the `.mjs` extension is a misnomer — this file uses TS-only
 * imports because the harness re-uses it through `node --import tsx`.
 * Kept under fixtures/ alongside fake-vtd.mjs so vitest does not treat
 * it as a test file.
 */

import { ensureVtDaemonForVault } from '../harness/nodeEnsureVtDaemonForVault.ts'

function arg(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const vault = arg('--vault')
const bin = arg('--bin')
const timeoutMs = Number(arg('--timeoutMs') ?? '10000')
const caller = arg('--caller') ?? 'electron'

if (!vault || !bin) {
  process.stderr.write('ensure-vtd-child: --vault and --bin required\n')
  process.exit(2)
}

try {
  const result = await ensureVtDaemonForVault(vault, caller, {
    bin,
    timeoutMs,
  })
  process.stdout.write(
    JSON.stringify({
      ok: true,
      port: result.port,
      pid: result.pid,
      ownerNonce: result.ownerNonce,
      authToken: result.authToken,
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
