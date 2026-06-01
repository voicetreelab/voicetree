// Handler for the authenticated GET /settings route.
//
// Delivers the project's resolved VTSettings (read from
// $VOICETREE_HOME/settings.json merged with defaults) to a browser tab so the
// browser-mode ElectronAPI adapter has the same settings the Electron renderer
// receives over IPC. The browser needs this for `agents` (drives the editor
// horizontal menu / agent-spawn control), context-distance, vim mode, etc.
//
// Security model: unlike /browser-token this route sits BEHIND the bearer-token
// gate (settings include INJECT_ENV_VARS). The browser obtains the token via
// /browser-token first, then calls /settings with Authorization: Bearer <token>.

import type {IncomingMessage, ServerResponse} from 'node:http'
import {loadSettings} from '@vt/app-config/settings'
import type {AccessLogger} from '../httpServerTypes.ts'
import {buildAccessLogLine} from '../accessLog.ts'

export async function handleSettings(
    req: IncomingMessage,
    res: ServerResponse,
    logger: AccessLogger,
): Promise<void> {
    try {
        const settings = await loadSettings()
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(settings))
        logger.logRequest(buildAccessLogLine(req, 200))
    } catch (err) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({error: (err as Error).message}))
        logger.logRequest(buildAccessLogLine(req, 500))
    }
}
