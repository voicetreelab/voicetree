// Black-box round-trip tests for the clipboard-image routes.
// Brings up a real server via startHttpDaemonServer and exercises the wire:
//   POST /clipboard-image  → assert the bytes actually land on disk as a sibling
//   GET  /image            → assert the SAME bytes come back, byte-for-byte
// Assertions are on the observable side effects (the file, the response bytes) —
// no internal mocks, no spies.

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs'
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

async function bring(): Promise<{handle: HttpDaemonServerHandle; token: string}> {
    const token: string = generateAuthToken()
    const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog: emptyCatalog,
        token,
        bindHost: '127.0.0.1',
        allowedOrigins: [],
        logger: silentLogger,
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
