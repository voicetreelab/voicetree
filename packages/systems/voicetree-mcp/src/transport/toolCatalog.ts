// Tool catalog dispatcher map for the UDS JSON-RPC server.
//
// Thin transport adapter: defers to `tools/catalog.ts` (pure-data catalog with
// zod schemas + descriptions + handlers) for the actual mapping. The UDS
// server consumes the dispatcher map returned here; schema validation is
// performed inside the catalog entries' handlers and raises
// `CatalogValidationError` on rejection (caught by `udsServer.ts` and emitted
// as a JSON-RPC `validation_failed` error per design doc §4.4).

import {buildCatalogDispatchMap} from '../tools/catalog'
import type {ToolCatalog} from './udsServer'

export function buildDefaultToolCatalog(): ToolCatalog {
    return buildCatalogDispatchMap()
}
