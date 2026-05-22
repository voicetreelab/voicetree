// Dedicated WebSocket relay HTTP server for renderer-side tmux attach.
//
// Why a standalone server (rather than piggybacking on the hook HTTP server
// or the UDS socket):
// - The renderer cannot speak UDS — it's a browser context whose only IPC
//   affordance to a long-lived stream is WebSocket. So an HTTP server with
//   the upgrade route is the right transport.
// - The hook HTTP server is intentionally single-route per design doc §2.4.
//   Adding the relay's upgrade handler would erode that invariant.
// - The relay is Electron-only: in headless mode (vt-mcpd, vt serve) there's
//   no renderer, so no relay is started. Keeping the binding code in
//   webapp/ (not the shared package) localises that concern.
//
// Lifecycle: started on Electron `app.whenReady()`, stopped on `will-quit`.
// One ephemeral port for the lifetime of the app, exposed to the renderer
// via the `getTmuxRelayPort` entry in `mainAPI`.
//
// Replaces the relay previously mounted on the HTTP MCP server's listener
// (`mountTmuxAttachRelay(httpServer)` inside the deleted mcp-server.ts).

import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {mountTmuxAttachRelay, type TmuxAttachRelayHandle} from '@vt/agent-runtime/relay/tmux-attach-relay.ts'

interface BoundRelay {
    readonly server: Server
    readonly handle: TmuxAttachRelayHandle
    readonly port: number
}

let bound: BoundRelay | null = null

function rejectHttp(_req: IncomingMessage, res: ServerResponse): void {
    // The relay's only legitimate traffic is the WebSocket upgrade. HTTP GET
    // probes (e.g. by tooling that mistakes this port for an HTTP service)
    // get a 404 rather than dangling indefinitely.
    res.statusCode = 404
    res.end('tmux relay: WebSocket upgrade required')
}

export async function startTmuxRelayServer(): Promise<void> {
    if (bound) return

    const server: Server = createServer(rejectHttp)
    const handle: TmuxAttachRelayHandle = mountTmuxAttachRelay(server)

    const port: number = await new Promise<number>((resolveStart, rejectStart): void => {
        server.once('error', rejectStart)
        server.listen(0, '127.0.0.1', (): void => {
            server.removeListener('error', rejectStart)
            const address: ReturnType<Server['address']> = server.address()
            if (!address || typeof address === 'string') {
                rejectStart(new Error('tmux relay failed to bind: no address'))
                return
            }
            resolveStart(address.port)
        })
    })

    bound = {server, handle, port}
}

export async function stopTmuxRelayServer(): Promise<void> {
    if (!bound) return
    const local: BoundRelay = bound
    bound = null
    local.handle.close()
    await new Promise<void>((resolveStop): void => {
        local.server.close((): void => resolveStop())
    })
}

/**
 * Renderer-facing accessor (exposed via mainAPI.getTmuxRelayPort). Replaces
 * `getMcpPort()` for the WebSocket-relay discovery path. The renderer calls
 * this immediately before opening `ws://localhost:${port}/terminals/:id/attach`.
 *
 * Returns 0 when the relay has not yet bound; the renderer treats 0 as
 * "not ready" and retries — matching today's startup-race tolerance against
 * `getMcpPort()` before the MCP server bound.
 */
export function getTmuxRelayPort(): number {
    return bound?.port ?? 0
}
