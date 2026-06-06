/**
 * The VTD gateway method-name registry — every dotted JSON-RPC method the
 * browser (and the Electron main process, via its RPC client) can invoke
 * against the daemon, NAMESPACED BY FAMILY:
 *
 *   GATEWAY_METHODS.graph.getGraph      → 'graph.getGraph'
 *   GATEWAY_METHODS.worktree.list       → 'worktree.list'
 *
 * Every gateway consumer (the daemon route binders, the browser adapters, the
 * Electron-main RPC wrappers) imports this ONE symbol and reaches the whole
 * method surface through it, instead of importing each family's registry
 * separately. The per-family registries (`GRAPH_GATEWAY_METHODS`,
 * `WORKTREE_METHODS`) and their `*_METHOD_NAMES` iterables stay individually
 * exported so the per-family drift tests can still assert each family's exact
 * method-name set against its route handlers.
 */

import {GRAPH_GATEWAY_METHODS} from './graph-gateway-contract.ts'
import {WORKTREE_METHODS} from './worktree-contract.ts'

export const GATEWAY_METHODS = {
    graph: GRAPH_GATEWAY_METHODS,
    worktree: WORKTREE_METHODS,
} as const

export type GatewayMethodFamily = keyof typeof GATEWAY_METHODS
