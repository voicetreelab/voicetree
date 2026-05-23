// Public types for the headless HTTP daemon. Carved out so the
// transport-only `headlessServer.ts` and the vault-backed
// `vaultLiveCatalog.ts` can share the catalog shape without one importing
// the other.

export type ToolResult =
    | {readonly ok: true; readonly payload: unknown}
    | {readonly ok: false; readonly payload: unknown}

export type CatalogHandler = (params: Record<string, unknown>) => Promise<ToolResult>
export type Catalog = ReadonlyMap<string, CatalogHandler>

// JSON-RPC -32602 (`validation_failed`) wire support. A handler that needs to
// surface "input was malformed" throws this; the dispatcher maps it onto the
// `{kind: 'validation_failed', tool, issues}` envelope CLI callers
// already recognise (design doc §4.6, harmonised with vt-daemon).
export class CatalogValidationError extends Error {
    constructor(
        public readonly toolName: string,
        public readonly issues: readonly unknown[],
    ) {
        super(`Validation failed for ${toolName}`)
        this.name = 'CatalogValidationError'
    }
}

export interface HeadlessServerOptions {
    readonly vaultPath: string
    readonly catalog?: Catalog
    readonly host?: string
    readonly port?: number
}

export interface HeadlessServer {
    readonly url: string
    readonly port: number
    readonly token: string
    readonly vaultPath: string
    readonly close: () => Promise<void>
}
