/**
 * Minimal typed HTTP client for the standalone VTD (vt-daemon) controller.
 *
 * Wraps two transport surfaces of the BF-371 unified HTTP server:
 *  - `GET  /health` — unauthenticated identity probe (used by
 *    `ensureVtDaemonForVault` post-spawn validation).
 *  - `POST /rpc`    — JSON-RPC 2.0, bearer-authenticated; the tool dispatch
 *    surface VTD will grow into (BF-375 / BF-376 / BF-377).
 *
 * Deliberately narrow at this BF — the class is the deep public surface
 * Phase 2 consumers consume; the tool catalog is extended in later BFs by
 * adding typed methods that delegate to {@link VtDaemonClient.rpc}, not
 * by widening the constructor or auth model.
 *
 * Why not compose `@vt/vt-rpc`'s `createRpcClient`:
 *   - `createRpcClient` does discovery (cwd up-walk + env override) and
 *     reads the auth token from disk. Here we already hold both the bound
 *     `baseUrl` and the freshly-read `authToken` (from the ensure path),
 *     so discovery would be redundant indirection.
 *   - We replicate the SAME wire shape `createRpcClient.call` produces
 *     (JSON-RPC 2.0 envelope, Bearer header, EPIPE/timeouts surfaced as
 *     thrown errors) so a future tool method body on VtDaemonClient can
 *     swap to vt-rpc's `call` if the discovery cost ever becomes worth it.
 */

import {
  VtDaemonHealthResponseSchema,
  type VtDaemonHealthResponse,
} from '@vt/graph-db-protocol'

const DEFAULT_TIMEOUT_MS = 30_000
const HEALTH_TIMEOUT_MS = 1_500

export type VtDaemonClientOptions = {
  readonly baseUrl: string
  readonly authToken: string
}

interface JsonRpcSuccess {
  readonly jsonrpc: '2.0'
  readonly id: number | string | null
  readonly result: unknown
}

interface JsonRpcFailure {
  readonly jsonrpc: '2.0'
  readonly id: number | string | null
  readonly error: {
    readonly code: number
    readonly message: string
    readonly data?: unknown
  }
}

export type VtDaemonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export class VtDaemonClient {
  readonly #baseUrl: string
  readonly #authToken: string

  constructor(options: VtDaemonClientOptions) {
    // Strip trailing slash so `${baseUrl}/health` and `${baseUrl}/rpc`
    // produce stable URLs whether the caller passed `http://127.0.0.1:N`
    // or `http://127.0.0.1:N/`.
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.#authToken = options.authToken
  }

  get baseUrl(): string {
    return this.#baseUrl
  }

  get authToken(): string {
    return this.#authToken
  }

  /**
   * Probe the daemon's `/health` endpoint. Unauthenticated (the response
   * carries no secrets — only owner identity, vault path, uptime). The
   * body is validated against {@link VtDaemonHealthResponseSchema}; a
   * graphd-shaped body (no `daemonKind` discriminator) is rejected.
   */
  async health(): Promise<VtDaemonHealthResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(`${this.#baseUrl}/health`, {
        signal: controller.signal,
      })
    } catch (cause) {
      throw new Error(
        `vt-daemon /health unreachable at ${this.#baseUrl}: ${(cause as Error).message}`,
      )
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      throw new Error(
        `vt-daemon /health at ${this.#baseUrl} returned HTTP ${response.status}`,
      )
    }
    const body: unknown = await response.json().catch((cause: unknown): never => {
      throw new Error(
        `vt-daemon /health at ${this.#baseUrl} returned non-JSON: ${(cause as Error).message}`,
      )
    })
    const parsed = VtDaemonHealthResponseSchema.safeParse(body)
    if (!parsed.success) {
      throw new Error(
        `vt-daemon /health at ${this.#baseUrl} returned a response that does not match VtDaemonHealthResponseSchema`,
      )
    }
    return parsed.data
  }

  /**
   * Invoke a JSON-RPC 2.0 method on the daemon's `/rpc` endpoint with the
   * bearer token. The caller is responsible for typing the result; the
   * JSON-RPC envelope is unwrapped — a JSON-RPC error response throws.
   *
   * This BF wires up the transport only. Typed tool methods land in
   * BF-375 / BF-376 / BF-377 as thin wrappers over `rpc()`.
   */
  async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(`${this.#baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
        signal: controller.signal,
      })
    } catch (cause) {
      throw new Error(
        `vt-daemon /rpc unreachable at ${this.#baseUrl}: ${(cause as Error).message}`,
      )
    } finally {
      clearTimeout(timer)
    }
    if (response.status === 401) {
      throw new Error(
        `vt-daemon /rpc at ${this.#baseUrl} rejected the bearer token (401)`,
      )
    }
    if (!response.ok) {
      const text = await response.text().catch((): string => '')
      throw new Error(
        `vt-daemon /rpc at ${this.#baseUrl} returned HTTP ${response.status}: ${text.slice(0, 200)}`,
      )
    }
    const envelope: unknown = await response.json().catch((cause: unknown): never => {
      throw new Error(
        `vt-daemon /rpc at ${this.#baseUrl} returned non-JSON: ${(cause as Error).message}`,
      )
    })
    if (!isJsonRpc(envelope)) {
      throw new Error(`vt-daemon /rpc at ${this.#baseUrl} returned non-JSON-RPC body`)
    }
    if ('error' in envelope) {
      const err = envelope.error
      throw new Error(`vt-daemon /rpc ${method} failed: ${err.code} ${err.message}`)
    }
    return envelope.result as T
  }
}

function isJsonRpc(value: unknown): value is VtDaemonRpcResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  return obj.jsonrpc === '2.0'
}
