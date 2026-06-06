// Tool catalog dispatcher map for the unified HTTP JSON-RPC server (Step 9b).
//
// Thin transport adapter: defers to `tools/catalog.ts` (pure-data catalog with
// zod schemas + descriptions + handlers) for the actual mapping. The HTTP
// server consumes the dispatcher map returned here; schema validation is
// performed inside the catalog entries' handlers and raises
// `CatalogValidationError` on rejection (caught by `httpServer.ts` and emitted
// as a JSON-RPC `validation_failed` error per design doc §4.6).

import {buildCatalogDispatchMap} from '../tools/catalog'
import type {ToolCatalog} from './httpServer'
import type {ToolBridges} from '../config/toolBridges.ts'
import type {RpcRoute} from '../rpc/index.ts'

export function buildDefaultToolCatalog(
    bridges: ToolBridges,
    extraRoutes: readonly RpcRoute[] = [],
): ToolCatalog {
    return buildCatalogDispatchMap(bridges, extraRoutes)
}
