import type {IncomingMessage, ServerResponse} from 'node:http'
import type {AccessLogger, VtDaemonHealthResponse} from '../httpServerTypes.ts'
import {buildAccessLogLine} from '../accessLog.ts'

export function handleHealth(
    req: IncomingMessage,
    res: ServerResponse,
    readHealth: (() => VtDaemonHealthResponse) | undefined,
    logger: AccessLogger,
): void {
    res.setHeader('Content-Type', 'application/json')
    if (readHealth === undefined) {
        res.statusCode = 503
        res.end(JSON.stringify({error: 'health probe not wired'}))
        logger.logRequest(buildAccessLogLine(req, 503))
        return
    }
    res.statusCode = 200
    res.end(JSON.stringify(readHealth()))
    logger.logRequest(buildAccessLogLine(req, 200))
}
