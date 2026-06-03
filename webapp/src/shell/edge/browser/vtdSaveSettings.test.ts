// Black-box tests for the browser adapter's settings-WRITE client. A real
// loopback http.Server stands in for VTD's POST /settings; each test asserts the
// OBSERVABLE wire I/O — the HTTP method, the bearer header, the JSON body the
// server receives — and the value the client returns. No mocks, no spies.

import {afterEach, describe, expect, it} from 'vitest'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import type {VTSettings} from '@vt/graph-model/settings'
import {vtdSaveSettings} from './vtdRpc'

interface Captured {
    method: string | undefined
    auth: string | undefined
    contentType: string | undefined
    body: unknown
}

let server: Server | null = null

afterEach(async () => {
    if (server) await new Promise<void>(res => server!.close(() => res()))
    server = null
})

/** Bring up a loopback /settings server that replies `status`, capturing the request. */
async function bring(status: number): Promise<{url: string; last: () => Captured}> {
    let captured: Captured | null = null
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
        let body = ''
        req.on('data', c => { body += c })
        req.on('end', () => {
            captured = {
                method: req.method,
                auth: req.headers.authorization,
                contentType: req.headers['content-type'],
                body: body === '' ? null : JSON.parse(body),
            }
            res.statusCode = status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({darkMode: true, INJECT_ENV_VARS: {}}))
        })
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const {port} = server!.address() as AddressInfo
    return {url: `http://127.0.0.1:${port}`, last: () => captured!}
}

describe('vtdSaveSettings', () => {
    it('POSTs the settings as a bearer-authenticated JSON body and resolves true', async () => {
        const {url, last} = await bring(200)
        const settings = {darkMode: true, vimMode: false} as unknown as VTSettings

        const ok = await vtdSaveSettings(url, 'tok-123', settings)

        expect(ok).toBe(true)
        const c = last()
        expect(c.method).toBe('POST')
        expect(c.auth).toBe('Bearer tok-123')
        expect(c.contentType).toBe('application/json')
        expect(c.body).toEqual({darkMode: true, vimMode: false})
    })

    it('throws on a 401 auth failure', async () => {
        const {url} = await bring(401)
        await expect(vtdSaveSettings(url, 'bad', {} as VTSettings)).rejects.toThrow('401')
    })

    it('throws on a non-OK status', async () => {
        const {url} = await bring(500)
        await expect(vtdSaveSettings(url, 'tok', {} as VTSettings)).rejects.toThrow('POST /settings')
    })
})
