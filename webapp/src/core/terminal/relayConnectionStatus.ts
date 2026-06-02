/**
 * Connection status for a terminal relay attachment, surfaced to the UI by
 * both the Electron and browser transports. Runtime-neutral string union with
 * no dependencies — lives in core so neither edge has to import the other.
 */

export type RelayConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error'
