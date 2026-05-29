// Black-box test of the HTTP client against a real http.createServer.
// Mirrors the daemon's /rpc contract just enough to exercise: success result,
// JSON-RPC error in the body, 401 → DaemonAuthRequired, and connect-refused →
// DaemonUnreachable.

import http, {type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'

import {
    createRpcClient,
    createRpcClientForVault,
    DaemonAuthRequired,
    DaemonUnreachable,
} from '../src/httpClient.ts'
import {authTokenFilePath} from '../src/authTokenFile.ts'
import {writeRpcPortFile} from '../src/portFile.ts'

interface FakeDaemon {
    readonly server: Server
    readonly port: number
}

async function startFakeDaemon(token: string, handler: (req: IncomingMessage, body: string) => unknown): Promise<FakeDaemon> {
    const server: Server = http.createServer((req: IncomingMessage, res: ServerResponse): void => {
        let buf: string = ''
        req.on('data', (chunk: Buffer): void => { buf += chunk.toString('utf8') })
        req.on('end', (): void => {
            if (req.headers.authorization !== `Bearer ${token}`) {
                res.statusCode = 401
                res.end()
                return
            }
            const result: unknown = handler(req, buf)
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
        })
    })
    const port: number = await new Promise<number>((resolveListen, rejectListen): void => {
        server.once('error', rejectListen)
        server.listen(0, '127.0.0.1', (): void => {
            const addr = server.address()
            if (!addr || typeof addr === 'string') {
                rejectListen(new Error('no address'))
                return
            }
            resolveListen(addr.port)
        })
    })
    return {server, port}
}

async function makeVaultWith(token: string, port: number): Promise<string> {
    const vault: string = await mkdtemp(join(tmpdir(), 'vt-rpc-client-'))
    await mkdir(join(vault, '.voicetree'), {recursive: true})
    await writeFile(authTokenFilePath(vault), `${token}\n`, 'utf8')
    await writeRpcPortFile(vault, port)
    return vault
}

const active: FakeDaemon[] = []

afterEach(async (): Promise<void> => {
    while (active.length > 0) {
        const d: FakeDaemon = active.pop()!
        await new Promise<void>((resolve): void => { d.server.close((): void => resolve()) })
    }
})

describe('createRpcClient + call', (): void => {
    it('round-trips a JSON-RPC success', async (): Promise<void> => {
        const token: string = 'tok_success_abcdef'
        const fake: FakeDaemon = await startFakeDaemon(token, (_req, body): unknown => {
            const parsed = JSON.parse(body)
            return {jsonrpc: '2.0', id: parsed.id, result: {echoed: parsed.params}}
        })
        active.push(fake)
        const vault: string = await makeVaultWith(token, fake.port)

        const client = await createRpcClient({cwd: vault, env: {}})
        const res = await client.call('graph_structure', {scope: 'whole'}, 1)
        expect(res).toEqual({jsonrpc: '2.0', id: 1, result: {echoed: {scope: 'whole'}}})
    })

    it('passes JSON-RPC errors through verbatim (HTTP still 200)', async (): Promise<void> => {
        const token: string = 'tok_jsonrpc_error'
        const fake: FakeDaemon = await startFakeDaemon(token, (_req, body): unknown => {
            const parsed = JSON.parse(body)
            return {jsonrpc: '2.0', id: parsed.id, error: {code: -32601, message: 'Unknown method: nope'}}
        })
        active.push(fake)
        const vault: string = await makeVaultWith(token, fake.port)

        const client = await createRpcClient({cwd: vault, env: {}})
        const res = await client.call('nope', {}, 'abc')
        expect(res).toEqual({jsonrpc: '2.0', id: 'abc', error: {code: -32601, message: 'Unknown method: nope'}})
    })

    it('maps HTTP 401 to DaemonAuthRequired with auth_required code', async (): Promise<void> => {
        const realToken: string = 'tok_real_zzzz9999'
        const fake: FakeDaemon = await startFakeDaemon(realToken, (): unknown => ({jsonrpc: '2.0', id: 1, result: 'ok'}))
        active.push(fake)
        // Vault has a *different* token from what the daemon accepts.
        const vault: string = await makeVaultWith('tok_wrong_aaaa1111', fake.port)

        const client = await createRpcClient({cwd: vault, env: {}})
        await expect(client.call('any_method', {}, 1)).rejects.toBeInstanceOf(DaemonAuthRequired)
        try {
            await client.call('any_method', {}, 1)
        } catch (err) {
            expect((err as DaemonAuthRequired).code).toBe(-32004)
        }
    })

    it('maps connect-refused to DaemonUnreachable with daemon_unreachable code', async (): Promise<void> => {
        const vault: string = await makeVaultWith('tok_unused_bbbb2222', 1) // port 1 will refuse
        const client = await createRpcClient({cwd: vault, env: {}})
        await expect(client.call('any', {}, 1)).rejects.toBeInstanceOf(DaemonUnreachable)
        try {
            await client.call('any', {}, 1)
        } catch (err) {
            expect((err as DaemonUnreachable).code).toBe(-32000)
        }
    })

    it('createRpcClient throws DaemonUnreachable when no endpoint resolves', async (): Promise<void> => {
        const isolated: string = await mkdtemp(join(tmpdir(), 'vt-rpc-no-endpoint-'))
        await expect(createRpcClient({cwd: isolated, env: {}})).rejects.toBeInstanceOf(DaemonUnreachable)
    })
})

describe('createRpcClientForVault', (): void => {
    it('round-trips against the explicit vault, ignoring cwd', async (): Promise<void> => {
        const token: string = 'tok_vault_only_zzzz'
        const fake: FakeDaemon = await startFakeDaemon(token, (_req, body): unknown => {
            const parsed = JSON.parse(body)
            return {jsonrpc: '2.0', id: parsed.id, result: {ok: true}}
        })
        active.push(fake)
        const vault: string = await makeVaultWith(token, fake.port)

        // Pass env={} — no $VOICETREE_PROJECT_PATH and no $VOICETREE_DAEMON_URL.
        // The standard `createRpcClient` would fail here (no discovery hits);
        // `createRpcClientForVault` succeeds because vault is explicit.
        const client = await createRpcClientForVault(vault, {env: {}})
        const res = await client.call('any_method', {a: 1}, 7)
        expect(res).toEqual({jsonrpc: '2.0', id: 7, result: {ok: true}})
        expect(client.endpoint.vaultPath).toBe(vault)
    })

    it('throws DaemonUnreachable when the vault has no rpc.port and no env URL', async (): Promise<void> => {
        const vault: string = await mkdtemp(join(tmpdir(), 'vt-rpc-vault-noport-'))
        await mkdir(join(vault, '.voicetree'), {recursive: true})
        await expect(createRpcClientForVault(vault, {env: {}}))
            .rejects.toBeInstanceOf(DaemonUnreachable)
    })

    it('throws when the vault has rpc.port but no auth-token', async (): Promise<void> => {
        const fake: FakeDaemon = await startFakeDaemon('tok_unused', (): unknown => ({jsonrpc: '2.0', id: 1, result: 'ok'}))
        active.push(fake)
        const vault: string = await mkdtemp(join(tmpdir(), 'vt-rpc-vault-notoken-'))
        await mkdir(join(vault, '.voicetree'), {recursive: true})
        await writeRpcPortFile(vault, fake.port)
        // Deliberately do NOT write the auth-token file.
        await expect(createRpcClientForVault(vault, {env: {}}))
            .rejects.toBeInstanceOf(DaemonUnreachable)
    })
})
