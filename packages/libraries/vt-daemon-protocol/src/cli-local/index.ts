/**
 * CLI-local doc-only tool specs.
 *
 * These describe `vt` verbs that exist purely on the CLI surface and do
 * NOT dispatch to a daemon RPC. They populate the rendered manual
 * (`MANUAL_SPECS` = `TOOL_SPECS` + `CLI_LOCAL_SPECS`) so `vt manual` and
 * `vt manual <verb>` cover them, but they are intentionally absent from
 * the daemon's RPC catalog (`catalog.ts` iterates `TOOL_SPECS` only).
 *
 * A CLI-local spec omits the top-level `rpcName` (there is no wire
 * dispatch key) and each of its inputs omits `rpcName` too, with an
 * empty `annotation` when the flag has no RPC mapping.
 *
 * Each verb family lives in its own sibling file (kept under the
 * per-file line limit) exporting a `*_SPECS` array; this index spreads
 * them into the single flat `CLI_LOCAL_SPECS` the manual consumes.
 */

import type {ToolSpec} from '../tool-spec-types.ts'
import {PROJECT_SPECS} from './project.ts'
import {SESSION_SPECS} from './session.ts'
import {VIEW_SPECS} from './view.ts'
import {GRAPH_LIVE_SPECS} from './graph-live.ts'
import {GRAPH_FS_SPECS} from './graph-fs.ts'
import {DEBUG_SPECS} from './debug.ts'
import {TOP_LEVEL_SPECS} from './top-level.ts'

export const CLI_LOCAL_SPECS: readonly ToolSpec[] = [
    ...PROJECT_SPECS,
    ...SESSION_SPECS,
    ...VIEW_SPECS,
    ...GRAPH_LIVE_SPECS,
    ...GRAPH_FS_SPECS,
    ...DEBUG_SPECS,
    ...TOP_LEVEL_SPECS,
]
