/**
 * Programmatic entry point.
 *
 * The CLI's primary surface is the `cgcli` binary. Tools that want to embed
 * the commands import the specific command module directly:
 *
 *   import {findSymbol} from '@vt/code-graph-cli/commands/find-symbol'
 *
 * This file exposes only the two pieces every consumer needs.
 */
export {loadGraph} from './graph/load-graph.ts'
export {format} from './format/output.ts'
