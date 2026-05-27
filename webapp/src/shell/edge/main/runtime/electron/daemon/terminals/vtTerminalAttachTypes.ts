/**
 * Renderer-visible types for the /terminals/:id/attach IPC bridge
 * (Phase 0 / BF-368).
 *
 * `import type` only — no runtime dependency. Main owns the client and
 * the WebSocket; renderer holds opaque handle ids and consumes status frames.
 */

export type RelayConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error'
