/**
 * Pure, runtime-neutral codec for the tmux-attach relay wire protocol.
 *
 * Single source of truth for the frames exchanged with
 * `packages/systems/vt-daemon/.../relay/tmux-attach-relay.ts`. Both edge
 * transports — the Electron Node-`ws` client and the browser DOM-WebSocket
 * client — import this so the wire format can never drift between them.
 *
 * No `ws`, DOM, or fetch dependencies: this module is importable from any
 * runtime. The only environment branch is a `typeof Buffer` guard inside
 * `decodeWsData`, which stays inert (and pure) in the browser.
 *
 * Wire frames (verbatim from the relay):
 *   server→client: { type: 'data', payload }
 *   server→client: { type: 'exit', code }
 *   client→server: { type: 'data', payload }
 *   client→server: { type: 'resize', cols, rows }
 *   client→server: { type: 'scroll', direction: 'up'|'down', lines }
 */

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

/**
 * Decode a raw WebSocket frame into a utf-8 string. Handles every shape the
 * two transports can deliver: DOM `string`/`ArrayBuffer` and Node `ws`
 * `Buffer`/`Buffer[]`. The `Buffer` branches are `typeof Buffer`-guarded so
 * the module stays pure in the browser. Returns `''` for unrecognized inputs.
 */
export function decodeWsData(data: unknown): string {
    if (typeof data === 'string') return data
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
    if (typeof Buffer !== 'undefined') {
        if (Buffer.isBuffer(data)) return data.toString('utf-8')
        if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf-8')
    }
    return ''
}
