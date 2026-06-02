/**
 * Pure, runtime-neutral codec for the tmux-attach relay wire protocol.
 *
 * Single source of truth for the frames exchanged with
 * `packages/systems/vt-daemon/.../relay/tmux-attach-relay.ts`. Both edge
 * transports — the Electron Node-`ws` client and the browser DOM-WebSocket
 * client — import this so the wire format can never drift between them.
 *
 * No `ws`, DOM, or fetch dependencies: this module is importable from any
 * runtime. Raw-frame decoding is delegated to the shared `decodeWsData`
 * (`@/core/ws/decodeWsData`), re-exported here for the relay's consumers.
 *
 * Wire frames (verbatim from the relay):
 *   server→client: { type: 'data', payload }
 *   server→client: { type: 'exit', code }
 *   client→server: { type: 'data', payload }
 *   client→server: { type: 'resize', cols, rows }
 *   client→server: { type: 'scroll', direction: 'up'|'down', lines }
 */

export {decodeWsData} from '@/core/ws/decodeWsData'

export type RelayServerMessage =
    | {readonly type: 'data'; readonly payload: string}
    | {readonly type: 'exit'; readonly code: number | null}

export type RelayClientMessage =
    | {readonly type: 'data'; readonly payload: string}
    | {readonly type: 'resize'; readonly cols: number; readonly rows: number}
    | {readonly type: 'scroll'; readonly direction: 'up' | 'down'; readonly lines: number}

/**
 * Parse a server→client frame. `raw` must already be a decoded string
 * (use `decodeWsData` first). Returns `null` for malformed JSON or any frame
 * that does not match a known server message shape.
 */
export function parseRelayServerMessage(raw: string): RelayServerMessage | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const msg = parsed as {readonly type?: unknown; readonly payload?: unknown; readonly code?: unknown}

    if (msg.type === 'data' && typeof msg.payload === 'string') {
        return {type: 'data', payload: msg.payload}
    }
    if (msg.type === 'exit') {
        return {type: 'exit', code: typeof msg.code === 'number' ? msg.code : null}
    }
    return null
}

/** Serialize a client→server frame into the exact JSON the relay accepts. */
export function serializeRelayClientMessage(msg: RelayClientMessage): string {
    return JSON.stringify(msg)
}
