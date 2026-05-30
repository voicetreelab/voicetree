/**
 * The full set of specs the rendered manual documents.
 *
 * `MANUAL_SPECS` = the daemon-dispatched `TOOL_SPECS` (which the catalog
 * binds, one RPC each) followed by the CLI-local doc-only `CLI_LOCAL_SPECS`
 * (verbs that exist only on the CLI and never dispatch to a daemon RPC).
 *
 * The manual renderer (`renderFullManual`) and `vt manual` source from
 * this array so every documented verb appears, while the daemon catalog
 * stays bound to `TOOL_SPECS` alone — decoupling documentation coverage
 * from RPC dispatch.
 */

import type {ToolSpec} from './tool-spec-types.ts'
import {TOOL_SPECS} from './tool-specs.ts'
import {CLI_LOCAL_SPECS} from './cli-local/index.ts'

export const MANUAL_SPECS: readonly ToolSpec[] = [...TOOL_SPECS, ...CLI_LOCAL_SPECS]
