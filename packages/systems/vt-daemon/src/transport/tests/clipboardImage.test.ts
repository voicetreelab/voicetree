// Black-box round-trip tests for the clipboard-image routes.
// Brings up a real server via startHttpDaemonServer and exercises the wire:
//   POST /clipboard-image  → assert the bytes actually land on disk as a sibling
//   GET  /image            → assert the SAME bytes come back, byte-for-byte
// Assertions are on the observable side effects (the file, the response bytes) —
// no internal mocks, no spies.

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {generateAuthToken} from '@vt/vt-rpc'
import {startHttpDaemonServer, type HttpDaemonServerHandle, type ToolCatalog} from '../httpServer.ts'

const emptyCatalog: ToolCatalog = new Map()
const silentLogger = {logRequest: (): void => {}, logError: (): void => {}}

const active: HttpDaemonServerHandle[] = []
let workDir: string

beforeEach((): void => {
    workDir = mkdtempSync(join(tmpdir(), 'vtd-clipimg-test-'))
})

afterEach(async (): Promise<void> => {
    while (active.length > 0) {
        await active.pop()!.stop().catch((): void => {})
    }
    rmSync(workDir, {recursive: true, force: true})
})

// The FS routes are scoped to the project allowlist; the server is brought up
// with `workDir` as the project root (+ read path), so in-project paths
// round-trip and anything outside 404s. `allowlistRoot` overrides the root for
// the fail-closed / out-of-scope cases.
async function bring(
    allowlistRoot: string = workDir,
): Promise<{handle: HttpDaemonServerHandle; token: string}> {
    const token: string = generateAuthToken()
    const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog: emptyCatalog,
        token,
        bindHost: '127.0.0.1',
        allowedOrigins: [],
        logger: silentLogger,
        getProjectState: async () => ({
            projectRoot: allowlistRoot,
            readPaths: [allowlistRoot],
            writeFolderPath: allowlistRoot,
        }),
    })
    active.push(handle)
    return {handle, token}
}

// A tiny but non-trivial PNG byte sequence (signature + arbitrary payload).
const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0xff, 0xfe, 0x00, 0x42,
])

describe('clipboard-image routes', (): void => {
    it('writes posted bytes to a sibling file and reads them back byte-for-byte', async (): Promise<void> => {
        const {handle, token} = await bring()
        const nodeId = join(workDir, 'note.md')

        const post = await fetch(`${handle.url}/clipboard-image?nodeId=${encodeURIComponent(nodeId)}`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'image/png'},
            body: PNG_BYTES,
        })
        expect(post.status).toBe(200)
        const {filename} = await post.json() as {filename: string}
        expect(filename).toMatch(/^pasted-\d+\.png$/)

        // Side effect: the file exists next to the node with the exact bytes.
        const onDisk = readFileSync(join(workDir, filename))
        expect(new Uint8Array(onDisk)).toEqual(PNG_BYTES)

        // Round-trip: GET /image returns the identical bytes + png content type.
        const get = await fetch(`${handle.url}/image?path=${encodeURIComponent(join(workDir, filename))}`, {
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(get.status).toBe(200)
        expect(get.headers.get('content-type')).toBe('image/png')
        const back = new Uint8Array(await get.arrayBuffer())
        expect(back).toEqual(PNG_BYTES)
    })

    it('derives the extension from the Content-Type (jpeg → .jpg)', async (): Promise<void> => {
        const {handle, token} = await bring()
        const nodeId = join(workDir, 'note.md')
        const post = await fetch(`${handle.url}/clipboard-image?nodeId=${encodeURIComponent(nodeId)}`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg'},
            body: PNG_BYTES,
        })
        const {filename} = await post.json() as {filename: string}
        expect(filename).toMatch(/^pasted-\d+\.jpg$/)
    })

    it('GET /image returns 404 for a missing file', async (): Promise<void> => {
        const {handle, token} = await bring()
        const res = await fetch(`${handle.url}/image?path=${encodeURIComponent(join(workDir, 'nope.png'))}`, {
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(res.status).toBe(404)
    })

    it('POST rejects a nodeId whose folder does not exist (400, nothing written)', async (): Promise<void> => {
        const {handle, token} = await bring()
        const nodeId = join(workDir, 'no-such-dir', 'note.md')
        const res = await fetch(`${handle.url}/clipboard-image?nodeId=${encodeURIComponent(nodeId)}`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'image/png'},
            body: PNG_BYTES,
        })
        expect(res.status).toBe(400)
        expect(readdirSync(workDir)).toEqual([])
    })

    it('GET /image 404s a real file OUTSIDE the allowlist (indistinguishable from missing)', async (): Promise<void> => {
        const {handle, token} = await bring()
        const outside = mkdtempSync(join(tmpdir(), 'vtd-clipimg-outside-'))
        const secret = join(outside, 'secret.png')
        writeFileSync(secret, PNG_BYTES)
        try {
            const res = await fetch(`${handle.url}/image?path=${encodeURIComponent(secret)}`, {
                headers: {Authorization: `Bearer ${token}`},
            })
            // Same 404 + body as a genuinely missing file — no existence leak.
            expect(res.status).toBe(404)
            expect(await res.json()).toEqual({error: 'image not found'})
        } finally {
            rmSync(outside, {recursive: true, force: true})
        }
    })

    it('GET /image 404s a `..` traversal that escapes the allowlist', async (): Promise<void> => {
        const {handle, token} = await bring()
        const outside = mkdtempSync(join(tmpdir(), 'vtd-clipimg-outside-'))
        writeFileSync(join(outside, 'secret.png'), PNG_BYTES)
        // workDir/../<outsideBasename>/secret.png lexically starts with workDir's parent.
        const escape = join(workDir, '..', outside.split('/').pop()!, 'secret.png')
        try {
            const res = await fetch(`${handle.url}/image?path=${encodeURIComponent(escape)}`, {
                headers: {Authorization: `Bearer ${token}`},
            })
            expect(res.status).toBe(404)
        } finally {
            rmSync(outside, {recursive: true, force: true})
        }
    })

    it('GET /image 404s an in-allowlist symlink that points OUTSIDE', async (): Promise<void> => {
        const {handle, token} = await bring()
        const outside = mkdtempSync(join(tmpdir(), 'vtd-clipimg-outside-'))
        writeFileSync(join(outside, 'secret.png'), PNG_BYTES)
        const link = join(workDir, 'link.png') // lives inside the project, resolves out
        symlinkSync(join(outside, 'secret.png'), link)
        try {
            const res = await fetch(`${handle.url}/image?path=${encodeURIComponent(link)}`, {
                headers: {Authorization: `Bearer ${token}`},
            })
            expect(res.status).toBe(404)
        } finally {
            rmSync(outside, {recursive: true, force: true})
        }
    })

    it('POST 404s + writes NOTHING when the target folder is outside the allowlist', async (): Promise<void> => {
        const {handle, token} = await bring()
        const outside = mkdtempSync(join(tmpdir(), 'vtd-clipimg-outside-'))
        const nodeId = join(outside, 'note.md')
        try {
            const res = await fetch(`${handle.url}/clipboard-image?nodeId=${encodeURIComponent(nodeId)}`, {
                method: 'POST',
                headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'image/png'},
                body: PNG_BYTES,
            })
            expect(res.status).toBe(404)
            expect(readdirSync(outside)).toEqual([]) // nothing landed outside the project
        } finally {
            rmSync(outside, {recursive: true, force: true})
        }
    })

    it('fails CLOSED: with no project scope wired, both routes 404 and write nothing', async (): Promise<void> => {
        const token = generateAuthToken()
        const handle = await startHttpDaemonServer({
            catalog: emptyCatalog, token, bindHost: '127.0.0.1', allowedOrigins: [], logger: silentLogger,
            // getProjectState intentionally omitted
        })
        active.push(handle)
        const nodeId = join(workDir, 'note.md')
        const post = await fetch(`${handle.url}/clipboard-image?nodeId=${encodeURIComponent(nodeId)}`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'image/png'},
            body: PNG_BYTES,
        })
        expect(post.status).toBe(404)
        expect(readdirSync(workDir)).toEqual([])
        const target = join(workDir, 'real.png')
        writeFileSync(target, PNG_BYTES)
        const get = await fetch(`${handle.url}/image?path=${encodeURIComponent(target)}`, {
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(get.status).toBe(404) // file exists, but no allowlist → fail closed
        expect(existsSync(target)).toBe(true) // read never deleted it; just refused
    })

    it('both routes require the bearer token (401 without it)', async (): Promise<void> => {
        const {handle} = await bring()
        const post = await fetch(`${handle.url}/clipboard-image?nodeId=${encodeURIComponent(join(workDir, 'n.md'))}`, {
            method: 'POST',
            headers: {'Content-Type': 'image/png'},
            body: PNG_BYTES,
        })
        expect(post.status).toBe(401)
        const get = await fetch(`${handle.url}/image?path=${encodeURIComponent(join(workDir, 'n.png'))}`)
        expect(get.status).toBe(401)
        // No file was written by the unauthenticated POST.
        expect(readdirSync(workDir)).toEqual([])
    })
})
