// Handlers for the authenticated clipboard-image routes:
//   POST /clipboard-image?nodeId=<abs markdown path>  — write pasted image bytes
//   GET  /image?path=<abs image path>                 — read image bytes back
//
// These give the browser-mode HostAPI adapter parity with Electron's native
// clipboard image I/O. In Electron the renderer reads the OS clipboard and
// writes a sibling file directly; the browser can't touch the filesystem, so it
// ships the bytes here and VTD — which owns the disk under the gateway model —
// performs the write. The write location/naming MATCHES Electron's
// saveClipboardImage (`pasted-<timestamp>.<ext>` next to the markdown node) so
// the `![[pasted-….png]]` wikilink the editor inserts resolves identically.
//
// Security model: both routes sit BEHIND the bearer-token gate AND are SCOPED to
// the project allowlist (project root + read paths). The bearer gate alone is not
// enough in browser-mode: the token lives in renderer memory and is re-mintable by
// any same-origin script via GET /browser-token, so it is not a secret — the
// effective defence is limiting what the token can DO. Every browser-supplied path
// is checked with `isPathWithinAllowlist` (realpath + `..` collapse, so a symlink
// or `../` escape can't slip through) before any disk touch:
//   - a read of a path outside the allowlist 404s exactly like a missing file,
//     leaking nothing about the filesystem beyond the project;
//   - a write whose target lands outside the allowlist 404s and writes nothing.
// When no project scope is wired the routes fail CLOSED (404). No path is invented —
// the caller supplies absolute node paths that already come from the graph.

import type {IncomingMessage, ServerResponse} from 'node:http'
import {writeFile, readFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname, extname, join} from 'node:path'
import {isPathWithinAllowlist, type FolderTreeProjectState} from '@vt/app-config/folders'
import {readBinaryBodyWithCap, IMAGE_BODY_LIMIT_BYTES} from '../bodyReader.ts'
import type {AccessLogger} from '../httpServerTypes.ts'
import {buildAccessLogLine} from '../accessLog.ts'

/**
 * Resolves the live project allowlist (project root + read paths) the routes
 * scope every FS touch to. Injected at the edge (bin/vtd.ts wires it to
 * `gdb.client.getProject()`), mirroring how the `graph.*` folder routes get
 * their allowlist. Absent when the daemon was started without a project — then
 * the FS routes fail closed.
 */
export type ProjectStateProvider = () => Promise<FolderTreeProjectState>

// Clipboard content-type → file extension. Mirrors the reverse map below and
// Electron's saveClipboardImage default of PNG when the type is unknown.
const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
}

const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
}

export function imageExtensionForContentType(contentType: string | undefined): string {
    const base = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
    return EXTENSION_BY_CONTENT_TYPE[base] ?? 'png'
}

export function imageContentTypeForPath(filePath: string): string {
    return CONTENT_TYPE_BY_EXTENSION[extname(filePath).toLowerCase()] ?? 'image/png'
}

function queryParam(req: IncomingMessage, name: string): string | null {
    return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get(name)
}

function badRequest(req: IncomingMessage, res: ServerResponse, message: string, logger: AccessLogger): void {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({error: message}))
    logger.logRequest(buildAccessLogLine(req, 400))
}

// A single, content-free 404 used for BOTH "file missing" and "outside the
// allowlist" so the two are indistinguishable — a caller can't probe whether a
// file exists outside the project by reading the status or body.
function notFound(req: IncomingMessage, res: ServerResponse, logger: AccessLogger): void {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({error: 'image not found'}))
    logger.logRequest(buildAccessLogLine(req, 404))
}

/**
 * POST /clipboard-image?nodeId=<abs markdown path> — body is raw image bytes,
 * Content-Type carries the image MIME. Writes `pasted-<timestamp>.<ext>` next to
 * the markdown node and returns `{filename}` (the relative name the editor turns
 * into a `![[…]]` wikilink), matching Electron's saveClipboardImage contract.
 */
export async function handleSaveClipboardImage(
    req: IncomingMessage,
    res: ServerResponse,
    nowMs: number,
    logger: AccessLogger,
    getProjectState: ProjectStateProvider | undefined,
): Promise<void> {
    const nodeId = queryParam(req, 'nodeId')
    if (nodeId === null || nodeId.trim() === '') {
        badRequest(req, res, 'missing nodeId query parameter', logger)
        return
    }
    const folder = dirname(nodeId)
    // Scope the write to the project allowlist FIRST: a target outside the
    // project (or no project scope at all) 404s and never touches disk.
    const projectState = await getProjectState?.()
    if (projectState === undefined || !(await isPathWithinAllowlist(folder, projectState))) {
        notFound(req, res, logger)
        return
    }
    if (!existsSync(folder)) {
        badRequest(req, res, `target folder does not exist: ${folder}`, logger)
        return
    }

    const body = await readBinaryBodyWithCap(req, IMAGE_BODY_LIMIT_BYTES)
    if ('tooLarge' in body) {
        res.statusCode = 413
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({error: 'image too large'}))
        logger.logRequest(buildAccessLogLine(req, 413))
        return
    }
    if (body.length === 0) {
        badRequest(req, res, 'empty image body', logger)
        return
    }

    const ext = imageExtensionForContentType(req.headers['content-type'])
    const filename = `pasted-${nowMs}.${ext}`
    await writeFile(join(folder, filename), body)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({filename}))
    logger.logRequest(buildAccessLogLine(req, 200))
}

/**
 * GET /image?path=<abs image path> — streams the file's bytes back with the
 * MIME derived from its extension. 404 when the file is absent (the adapter maps
 * that to a null data URL, matching Electron's readImageAsDataUrl).
 */
export async function handleReadImage(
    req: IncomingMessage,
    res: ServerResponse,
    logger: AccessLogger,
    getProjectState: ProjectStateProvider | undefined,
): Promise<void> {
    const path = queryParam(req, 'path')
    if (path === null || path.trim() === '') {
        badRequest(req, res, 'missing path query parameter', logger)
        return
    }
    // Outside the allowlist (or no project scope) is indistinguishable from a
    // missing file: both 404 with the same body, so an attacker can't probe
    // for files outside the project.
    const projectState = await getProjectState?.()
    const withinAllowlist = projectState !== undefined && (await isPathWithinAllowlist(path, projectState))
    if (!withinAllowlist || !existsSync(path)) {
        notFound(req, res, logger)
        return
    }

    const bytes = await readFile(path)
    res.statusCode = 200
    res.setHeader('Content-Type', imageContentTypeForPath(path))
    res.end(bytes)
    logger.logRequest(buildAccessLogLine(req, 200))
}
