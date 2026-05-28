// Access-log line builder. Authorization header is redacted via
// @vt/vt-rpc#redactAuthorizationHeader (last-4 of the bearer token only).
// Split into its own file so route-handler siblings can log uniformly
// without circular imports back into the router.

import type {IncomingMessage} from 'node:http'

import {redactAuthorizationHeader} from '@vt/vt-rpc'
import {authorizationHeaderOf} from './wsUpgradeAuth.ts'

export function buildAccessLogLine(req: IncomingMessage, status: number): string {
    const authHeader: string | undefined = authorizationHeaderOf(req)
    const redacted: string = authHeader
        ? redactAuthorizationHeader(authHeader)
        : '<none>'
    return `[httpDaemon] ${req.method ?? '-'} ${req.url ?? '-'} ${status} authorization="${redacted}"`
}
