/**
 * Decode a raw WebSocket frame into a utf-8 string. Handles every shape the
 * browser DOM and Node `ws` transports can deliver: DOM `string`/`ArrayBuffer`
 * and Node `ws` `Buffer`/`Buffer[]`. The `Buffer` branches are
 * `typeof Buffer`-guarded so the module stays pure in the browser. Returns `''`
 * for unrecognized inputs.
 *
 * Runtime-neutral and dependency-free: importable from any edge transport
 * (terminal relay, /events client) so the frame-decode logic never drifts.
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
