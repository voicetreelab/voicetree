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
 *   - `buildCatalogEntry(spec, rpcName, inputShape, handler)` constructs
 *     the `CatalogEntry` from a spec, taking the resolved `name` (the
 *     daemon RPC dispatch key) explicitly and pulling `description` from
 *     the spec. The caller resolves `rpcName` once (guarding the
 *     now-optional `spec.rpcName`) and passes it through.
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
                + `Known inputs: ${spec.inputs.map((entry: ToolInputSpec): string => entry.rpcName ?? '(no-rpc)').join(', ') || '(none)'}.`,
            )
        }
        return input.description
    }
}

export function buildCatalogEntry(
    spec: ToolSpec,
    rpcName: string,
    inputShape: ZodRawShape,
    handler: BridgedCatalogHandler,
): CatalogEntry {
    return {
        name: rpcName,
        description: spec.description,
        inputShape,
        handler,
    }
}
