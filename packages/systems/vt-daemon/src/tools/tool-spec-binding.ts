/**
 * Bridges the protocol-level `ToolSpec` data into the daemon's
 * `CatalogEntry` shape. The catalog binding lives here (in `@vt/vt-daemon`)
 * rather than in `@vt/vt-daemon-protocol` because the catalog couples
 * specs to zod schemas + bridged handlers, both of which are daemon
 * concerns and would force the protocol package to take a zod dep if
 * they lived there.
 *
 * Two helpers:
 *   - `specDescribe(spec)` returns a `(rpcPath) => string` lookup used
 *     by zod `.describe()` calls so the per-input description text is
 *     sourced from the spec rather than re-typed in the catalog.
 *   - `buildCatalogEntry(spec, inputShape, handler)` constructs the
 *     `CatalogEntry` from a spec, pulling `name` and `description`
 *     from the spec automatically.
 */

import type {ZodRawShape} from 'zod'
import type {ToolInputSpec, ToolSpec} from '@vt/vt-daemon-protocol'
import type {BridgedCatalogHandler, CatalogEntry} from './catalog'

export function specDescribe(spec: ToolSpec): (rpcPath: string) => string {
    return (rpcPath: string): string => {
        const input: ToolInputSpec | undefined = spec.inputs.find(
            (entry: ToolInputSpec): boolean => entry.rpcName === rpcPath,
        )
        if (!input) {
            throw new Error(
                `tool-spec-binding: spec '${spec.rpcName}' has no input named '${rpcPath}'. `
                + `Known inputs: ${spec.inputs.map((entry: ToolInputSpec): string => entry.rpcName).join(', ') || '(none)'}.`,
            )
        }
        return input.description
    }
}

export function buildCatalogEntry(
    spec: ToolSpec,
    inputShape: ZodRawShape,
    handler: BridgedCatalogHandler,
): CatalogEntry {
    return {
        name: spec.rpcName,
        description: spec.description,
        inputShape,
        handler,
    }
}
