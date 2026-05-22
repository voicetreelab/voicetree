import {
    readMetadata,
    writeMetadata,
    type NativeRecoveryHandle,
    type TmuxTerminalMetadata,
} from '../../terminals/terminal-registry/terminal-metadata'

export type PersistRecoveryDeps = {
    readonly readMetadata: (path: string) => TmuxTerminalMetadata | null
    readonly writeMetadata: (path: string, metadata: TmuxTerminalMetadata) => void
    readonly now: () => Date
}

export type PersistRecoveryRequest = {
    readonly metadataPath: string
    readonly cli: 'claude' | 'codex'
    readonly mode: 'interactive' | 'headless'
    readonly sessionId: string
    readonly source: 'claude-project-transcript' | 'codex-state-index'
    readonly providerStorePath?: string
}

export type PersistRecoveryResult =
    | {readonly kind: 'persisted'; readonly handle: NativeRecoveryHandle}
    | {readonly kind: 'metadata-missing'}

/**
 * Merges a resolved native session handle into the existing per-terminal
 * metadata file under `recovery.native`. All other persisted fields are
 * preserved. Returns `metadata-missing` if the metadata file cannot be read
 * (deleted, renamed, never existed) — callers should treat that as a no-op
 * rather than recreating metadata from scratch.
 *
 * The write is delegated to `writeMetadata` which already performs an atomic
 * temp-file rename, so partial writes are not observable.
 */
export function persistRecoveryNative(
    request: PersistRecoveryRequest,
    deps: PersistRecoveryDeps = defaultPersistRecoveryDeps(),
): PersistRecoveryResult {
    const existing: TmuxTerminalMetadata | null = deps.readMetadata(request.metadataPath)
    if (!existing) return {kind: 'metadata-missing'}
    const handle: NativeRecoveryHandle = {
        cli: request.cli,
        mode: request.mode,
        sessionId: request.sessionId,
        capturedAt: deps.now().toISOString(),
        source: request.source,
        ...(request.providerStorePath ? {providerStorePath: request.providerStorePath} : {}),
    }
    const merged: TmuxTerminalMetadata = {
        ...existing,
        recovery: {
            ...(existing.recovery ?? {}),
            native: handle,
        },
    }
    deps.writeMetadata(request.metadataPath, merged)
    return {kind: 'persisted', handle}
}

export function defaultPersistRecoveryDeps(): PersistRecoveryDeps {
    return {
        readMetadata,
        writeMetadata,
        now: () => new Date(),
    }
}
