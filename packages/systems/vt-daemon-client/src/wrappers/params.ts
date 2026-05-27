/**
 * Widen a typed Request into the loose `Record<string, unknown>` shape
 * VtDaemonClient.rpc expects. Pure type cast — the wire encoder
 * (JSON.stringify inside VtDaemonClient.rpc) does the runtime work; the
 * Request shapes in `@vt/vt-daemon-protocol` are already JSON-clean
 * (primitives, readonly arrays, fp-ts Options encoded as discriminated
 * `{_tag}` objects, branded strings).
 *
 * Wrappers route every call through this helper so the unsafe cast lives
 * in exactly one place and is auditable.
 */
export function asParams<R>(request: R): Record<string, unknown> {
    return request as unknown as Record<string, unknown>
}
