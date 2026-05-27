// /terminals/:id/attach wiring on the unified HTTP daemon (Step 9f).
//
// Owns a DEDICATED WebSocketServer for the tmux-attach route, separate from
// the /events WSS. The two routes have genuinely different inbound contracts:
//
//   - /events keeps maxPayload: 256 KiB (design doc §8.6) — its inbound frames
//     come from potentially untrusted publishers, so a flooding cap is part
//     of the threat model.
//   - /terminals/:id/attach has NO inbound frame cap — it is an authenticated
//     user-typing channel where multi-MB clipboard pastes are normal. Capping
//     them at 256 KiB would trip close 1009 mid-paste and lose terminal state.
//
// R2 decision recorded by Lochlan, 2026-05-22 (see step9f-risks-maxpayload.md).
//
// Auth runs BEFORE the upgrade reaches this wiring — buildUpgradeHandler in
// httpServer.ts validates the bearer token (header or subprotocol) and strips
// the Sec-WebSocket-Protocol header on header-auth so this WSS's handleProtocols
// only echoes vt-bearer for genuine subprotocol-auth upgrades.

import type {IncomingMessage} from 'node:http'
import type {Duplex} from 'node:stream'
import {WebSocket, WebSocketServer} from 'ws'

import {attachTmuxSessionToWebSocket} from '../agent-runtime/terminals/relay/tmux-attach-relay.ts'

import {VT_BEARER_SUBPROTOCOL} from './wsUpgradeAuth.ts'

const TERMINALS_ATTACH_PATTERN: RegExp = /^\/terminals\/[^/]+\/attach$/

export interface TmuxAttachWiring {
    readonly matchesPathname: (pathname: string) => boolean
    readonly acceptUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer, onAccepted: () => void) => void
    readonly close: () => Promise<void>
}

export function createTmuxAttachWiring(): TmuxAttachWiring {
    const wss: WebSocketServer = new WebSocketServer({
        noServer: true,
        // R2 (Lochlan): no inbound frame cap on this route — see header.
        maxPayload: undefined,
        // Echo vt-bearer only when the client genuinely sent it (subprotocol-auth
        // path). Header-auth has the protocol header stripped upstream, so this
        // hook fires only for subprotocol-auth requests.
        handleProtocols: (protocols: Set<string>): string | false =>
            protocols.has(VT_BEARER_SUBPROTOCOL) ? VT_BEARER_SUBPROTOCOL : false,
    })
    return {
        matchesPathname: (pathname: string): boolean => TERMINALS_ATTACH_PATTERN.test(pathname),
        acceptUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer, onAccepted: () => void): void => {
            wss.handleUpgrade(req, socket, head, (ws: WebSocket): void => {
                onAccepted()
                void attachTmuxSessionToWebSocket(ws, req)
            })
        },
        close: (): Promise<void> => new Promise<void>((resolveClose): void => {
            wss.close((): void => resolveClose())
        }),
    }
}
