// Handlers for the authenticated GET/POST /settings routes.
//
// GET delivers the project's resolved VTSettings (read from
// $VOICETREE_HOME/settings.json merged with defaults) to a browser tab so the
// browser-mode HostAPI adapter has the same settings the Electron renderer
// receives over IPC. The browser needs this for `agents` (drives the editor
// horizontal menu / agent-spawn control), context-distance, vim mode, etc.
//
// POST persists an edited settings patch back to disk (Electron parity for
// `saveSettings`). The renderer holds the browser-safe projection, edits a field,
// and POSTs the whole object back.
//
// Security model: both routes sit BEHIND the bearer-token gate, AND the payload
// is constrained by an explicit allowlist (`projectBrowserSafeSettings` on read,
// `saveBrowserSafeSettings` on write) that excludes `INJECT_ENV_VARS` (secrets),
// `hooks` and `shell` (host concerns). The bearer gate alone is not enough: any
// webapp XSS could otherwise read the token and leak secrets on GET, or overwrite
// secrets / inject host shell hooks on POST. The write path loads the on-disk
// settings and merges only allowlisted fields, so the renderer can neither read
// nor write a secret. The browser obtains the token via /browser-token first,
// then calls /settings with Authorization: Bearer <token>.

import type {IncomingMessage, ServerResponse} from 'node:http'
import {loadSettings} from '@vt/app-config/settings'
import {projectBrowserSafeSettings, saveBrowserSafeSettings} from './browserSafeSettings.ts'
import type {VTSettings} from '@vt/graph-model/settings'
import type {AccessLogger} from '../httpServerTypes.ts'
import {buildAccessLogLine} from '../accessLog.ts'
import {readBodyWithCap} from '../bodyReader.ts'

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(payload))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function handleSettings(
    req: IncomingMessage,
    res: ServerResponse,
    logger: AccessLogger,
): Promise<void> {
    try {
        const settings = projectBrowserSafeSettings(await loadSettings())
        sendJson(res, 200, settings)
        logger.logRequest(buildAccessLogLine(req, 200))
    } catch (err) {
        sendJson(res, 500, {error: (err as Error).message})
        logger.logRequest(buildAccessLogLine(req, 500))
    }
}

export async function handleSettingsWrite(
    req: IncomingMessage,
    res: ServerResponse,
    logger: AccessLogger,
): Promise<void> {
    const body: string | {readonly tooLarge: true} = await readBodyWithCap(req)
    if (typeof body !== 'string') {
        sendJson(res, 413, {error: 'settings payload too large'})
        logger.logRequest(buildAccessLogLine(req, 413))
        return
    }
    let incoming: unknown
    try {
        incoming = JSON.parse(body)
    } catch {
        sendJson(res, 400, {error: 'malformed JSON'})
        logger.logRequest(buildAccessLogLine(req, 400))
        return
    }
    if (!isPlainObject(incoming)) {
        sendJson(res, 400, {error: 'settings payload must be a JSON object'})
        logger.logRequest(buildAccessLogLine(req, 400))
        return
    }
    try {
        const saved = await saveBrowserSafeSettings(incoming as Partial<VTSettings>)
        sendJson(res, 200, saved)
        logger.logRequest(buildAccessLogLine(req, 200))
    } catch (err) {
        sendJson(res, 500, {error: (err as Error).message})
        logger.logRequest(buildAccessLogLine(req, 500))
    }
}
