/**
 * CLI-local doc-only tool specs for the `vt debug` family.
 *
 * The `vt debug` verbs are a headful, Chrome-DevTools-Protocol (CDP)
 * debugger for a running, unpackaged Voicetree dev (Electron) session.
 * `vt debug <command>` shells out to the `vt-debug` bin
 * (packages/libraries/graph-tools/bin/vt-debug.ts); none of these verbs
 * dispatch to a daemon JSON-RPC, so each spec omits the top-level
 * `rpcName` and every input omits `rpcName` (empty annotation).
 *
 * The 17 entries (parent + 16 subcommands) exceed the per-file line
 * limit, so the spec literals live in `debug-1.ts` (parent + first eight
 * subcommands) and `debug-2.ts` (remaining eight). This file just
 * concatenates them into the family export `DEBUG_SPECS`.
 */

import type {ToolSpec} from '../tool-spec-types.ts'
import {DEBUG_SPECS_PART_1} from './debug-1.ts'
import {DEBUG_SPECS_PART_2} from './debug-2.ts'

export const DEBUG_SPECS: readonly ToolSpec[] = [
    ...DEBUG_SPECS_PART_1,
    ...DEBUG_SPECS_PART_2,
]
