// Black-box tests for the browser-mode clipboard image client. A real loopback
// http.Server stands in for VTD; each test asserts the OBSERVABLE wire I/O —
// the bytes the server received, the bearer header, the query params — and the
// value the client returns. No mocks, no spies — the wire is the contract.

import {afterEach, describe, expect, it} from 'vitest'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
// jsdom's global Blob lacks a spec-compliant arrayBuffer(); use Node's real,
// spec-compliant Blob (matching what a browser provides at runtime). It's a
// genuine Blob — the cast only bridges the Node↔DOM Blob type declarations.
import {Blob as NodeBlob} from 'node:buffer'
import {bytesToDataUrl, uploadClipboardImage, vtdReadImageAsDataUrl} from './vtdImageClient'

function realBlob(bytes: Uint8Array, type: string): Blob {
    return new NodeBlob([bytes], {type}) as unknown as Blob
}

let server: Server | null = null

afterEach(async () => {
    if (server) await new Promise<void>(res => server!.close(() => res()))
    server = null
})

const IMG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x10, 0xff, 0xfe, 0x7a])

interface Captured {
    method: string | undefined
    url: string | undefined
    auth: string | undefined
    contentType: string | undefined
    body: Buffer
}

/** Bring up a loopback server running `handler`, capturing the inbound request. */
async function bring(
    handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void,
): Promise<{url: string; last: () => Captured}> {
    let captured: Captured | null = null
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
            const body = Buffer.concat(chunks)
            captured = {
                method: req.method,
                url: req.url,
                auth: req.headers.authorization,
                contentType: req.headers['content-type'],
                body,
            }
            handler(req, res, body)
        })
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const {port} = server!.address() as AddressInfo
    return {url: `http://127.0.0.1:${port}`, last: () => captured!}
}

describe('bytesToDataUrl', () => {
    it('encodes bytes as a base64 data URL with the given mime', () => {
        const url = bytesToDataUrl(new Uint8Array([0x68, 0x69]), 'image/png') // "hi"
        expect(url).toBe('data:image/png;base64,aGk=')
    })

    it('handles payloads larger than the chunk size without truncation', () => {
        const big = new Uint8Array(0x8000 * 2 + 5).fill(0x41) // 'A' repeated
        const url = bytesToDataUrl(big, 'image/png')
        const base64 = url.slice('data:image/png;base64,'.length)
        expect(Buffer.from(base64, 'base64')).toEqual(Buffer.from(big))
    })
})

describe('uploadClipboardImage', () => {
    it('POSTs the raw bytes + bearer + nodeId and returns the filename', async () => {
        const {url, last} = await bring((_req, res) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({filename: 'pasted-123.png'}))
        })
        const blob = realBlob(IMG_BYTES, 'image/png')
        const filename = await uploadClipboardImage(url, 'tok-9', '/proj/note.md', blob)

        expect(filename).toBe('pasted-123.png')
        const req = last()
        expect(req.method).toBe('POST')
        expect(req.url).toBe(`/clipboard-image?nodeId=${encodeURIComponent('/proj/note.md')}`)
        expect(req.auth).toBe('Bearer tok-9')
        expect(req.contentType).toBe('image/png')
        expect(new Uint8Array(req.body)).toEqual(IMG_BYTES)
    })

    it('throws on a non-OK response', async () => {
        const {url} = await bring((_req, res) => { res.statusCode = 500; res.end() })
        const blob = realBlob(IMG_BYTES, 'image/png')
        await expect(uploadClipboardImage(url, 'tok', '/p/n.md', blob)).rejects.toThrow(/500/)
    })
})

describe('vtdReadImageAsDataUrl', () => {
    it('round-trips the served bytes into a data URL with the response mime', async () => {
        const {url, last} = await bring((_req, res) => {
            res.setHeader('Content-Type', 'image/png')
            res.end(Buffer.from(IMG_BYTES))
        })
        const dataUrl = await vtdReadImageAsDataUrl(url, 'tok-7', '/proj/img.png')

        expect(dataUrl).toBe(bytesToDataUrl(IMG_BYTES, 'image/png'))
        const req = last()
        expect(req.url).toBe(`/image?path=${encodeURIComponent('/proj/img.png')}`)
        expect(req.auth).toBe('Bearer tok-7')
    })

    it('returns null when VTD answers 404', async () => {
        const {url} = await bring((_req, res) => { res.statusCode = 404; res.end() })
        expect(await vtdReadImageAsDataUrl(url, 'tok', '/proj/missing.png')).toBeNull()
    })
})
