/**
 * BF-380 · Phase 3 — Main-as-client live-command dispatch.
 *
 * Black-box: no internal mocks. The test stands up a tiny real HTTP listener
 * masquerading as the daemon's `/rpc` endpoint, writes the discovery files
 * (`.voicetree/rpc.port`, `.voicetree/auth-token`) so `@vt/vt-rpc`'s
 * `createRpcClientForProject` resolves to it, and installs a synthetic main
 * window so `renderer-live-state-proxy.applyRendererLiveCommand` has a
 * `webContents.executeJavaScript` boundary to push at.
 *
 * Assertions are observed at the *boundary*:
 *   - The HTTP listener received a `POST /rpc` for `vt_dispatch_live_command`.
 *   - The renderer's `executeJavaScript` was (or was not) invoked, depending
 *     on whether the command is renderer-owned.
 *   - The returned `Delta` carries the daemon's revision (not a locally
 *     computed one).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from '@vt/graph-state'

import { applyLiveCommand } from '@/shell/edge/main/runtime/state/live-state-store'
import {
    __setBoundVaultForTests,
} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import { setMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'

interface CapturedRpcRequest {
    readonly method: string
    readonly params: Record<string, unknown>
    readonly authorization: string | undefined
}

interface ExecutedScript {
    readonly script: string
}

interface DaemonStub {
    readonly url: string
    readonly port: number
    readonly receivedCalls: CapturedRpcRequest[]
    setNextResult(result: Record<string, unknown>): void
    close(): Promise<void>
}

async function startDaemonStub(): Promise<DaemonStub> {
    const receivedCalls: CapturedRpcRequest[] = []
    let nextResult: Record<string, unknown> = { delta: { revision: 0, cause: {} }, revision: 0 }

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse): void => {
        if (req.method !== 'POST' || req.url !== '/rpc') {
            res.statusCode = 404
            res.end()
            return
        }
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer): void => {
            chunks.push(chunk)
        })
        req.on('end', (): void => {
            const body: string = Buffer.concat(chunks).toString('utf-8')
            const parsed: { method: string; params: Record<string, unknown>; id: number | string } =
                JSON.parse(body)
            receivedCalls.push({
                method: parsed.method,
                params: parsed.params,
                authorization: req.headers['authorization'] as string | undefined,
            })
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: parsed.id,
                result: nextResult,
            }))
        })
    })

    await new Promise<void>((resolve: () => void): void => {
        server.listen(0, '127.0.0.1', resolve)
    })
    const address: ReturnType<Server['address']> = server.address()
    if (!address || typeof address === 'string') {
        throw new Error('daemon stub failed to bind')
    }
    const port: number = address.port

    return {
        url: `http://127.0.0.1:${port}`,
        port,
        receivedCalls,
        setNextResult: (result: Record<string, unknown>): void => {
            nextResult = result
        },
        close: async (): Promise<void> => {
            await new Promise<void>((resolve: () => void): void => {
                server.close((): void => resolve())
            })
        },
    }
}

interface RendererStubHandle {
    readonly executed: ExecutedScript[]
    detach(): void
}

function installRendererStub(): RendererStubHandle {
    const executed: ExecutedScript[] = []
    const synthetic: object = {
        isDestroyed: (): boolean => false,
        webContents: {
            isDestroyed: (): boolean => false,
            executeJavaScript: async (script: string): Promise<unknown> => {
                executed.push({ script })
                // The renderer proxy expects the script's IIFE return value
                // shape: { selection: string[] } from buildReadScript / buildApplyScript.
                return { selection: [] }
            },
        },
    }
    setMainWindow(synthetic as unknown as Electron.BrowserWindow)
    return {
        executed,
        detach: (): void => {
            // setMainWindow has no clear-to-null path; the next test's
            // installRendererStub overwrites. For after-suite tidiness we
            // overwrite with a destroyed-shaped stub so getMainWindow callers
            // outside this test treat it as gone.
            setMainWindow({
                isDestroyed: (): boolean => true,
                webContents: { isDestroyed: (): boolean => true },
            } as unknown as Electron.BrowserWindow)
        },
    }
}

describe('BF-380 — Main applyLiveCommand dispatches via JSON-RPC to the daemon', (): void => {
    let vault: string
    let daemon: DaemonStub
    let renderer: RendererStubHandle

    beforeAll(async (): Promise<void> => {
        vault = await mkdtemp(join(tmpdir(), 'bf380-rpc-'))
        await mkdir(join(vault, '.voicetree'), { recursive: true })
        await writeFile(join(vault, '.voicetree', 'auth-token'), 'test-bearer-token', { mode: 0o600 })
    })

    afterAll(async (): Promise<void> => {
        await rm(vault, { recursive: true, force: true })
    })

    beforeEach(async (): Promise<void> => {
        daemon = await startDaemonStub()
        await writeFile(join(vault, '.voicetree', 'rpc.port'), `${daemon.port}\n`)
        __setBoundVaultForTests(vault)
        renderer = installRendererStub()
    })

    afterEach(async (): Promise<void> => {
        renderer.detach()
        __setBoundVaultForTests(null)
        await daemon.close()
    })

    it('non-renderer command (Move) hits ONLY the daemon RPC', async (): Promise<void> => {
        daemon.setNextResult({
            delta: {
                revision: 7,
                cause: { type: 'Move', id: '/x.md', to: { x: 4, y: 5 } },
                positionsMoved: [['/x.md', { x: 4, y: 5 }]],
            },
            revision: 7,
        })

        const cmd: Command = { type: 'Move', id: '/x.md', to: { x: 4, y: 5 } }
        const delta = await applyLiveCommand(cmd)

        // Daemon received exactly one dispatch call.
        expect(daemon.receivedCalls).toHaveLength(1)
        expect(daemon.receivedCalls[0]!.method).toBe('vt_dispatch_live_command')
        expect(daemon.receivedCalls[0]!.authorization).toBe('Bearer test-bearer-token')
        expect(daemon.receivedCalls[0]!.params).toEqual({
            command: { type: 'Move', id: '/x.md', to: { x: 4, y: 5 } },
        })

        // Renderer was not invoked — Move is not renderer-owned.
        expect(renderer.executed).toHaveLength(0)

        // The returned delta is the daemon's (revision 7), not locally computed.
        expect(delta.revision).toBe(7)
        // Positions hydrated from wire-array back into Map.
        expect(delta.positionsMoved).toBeInstanceOf(Map)
        expect(delta.positionsMoved?.get('/x.md')).toEqual({ x: 4, y: 5 })
    })

    it('renderer-owned command (Select) hits BOTH renderer and daemon RPC', async (): Promise<void> => {
        daemon.setNextResult({
            delta: {
                revision: 3,
                cause: { type: 'Select', ids: ['/a.md'] },
                selectionAdded: ['/a.md'],
            },
            revision: 3,
        })

        const cmd: Command = { type: 'Select', ids: ['/a.md'] }
        const delta = await applyLiveCommand(cmd)

        // Renderer executeJavaScript called once: the apply script.
        expect(renderer.executed).toHaveLength(1)
        expect(renderer.executed[0]!.script).toContain('applyLiveCommand')

        // Daemon also called with the same command.
        expect(daemon.receivedCalls).toHaveLength(1)
        expect(daemon.receivedCalls[0]!.method).toBe('vt_dispatch_live_command')
        expect(daemon.receivedCalls[0]!.params).toEqual({
            command: { type: 'Select', ids: ['/a.md'] },
        })

        // Daemon's revision is what the caller sees.
        expect(delta.revision).toBe(3)
        expect(delta.selectionAdded).toEqual(['/a.md'])
    })

    it('rejects when no vault is bound', async (): Promise<void> => {
        __setBoundVaultForTests(null)
        await expect(applyLiveCommand({ type: 'Move', id: '/x.md', to: { x: 1, y: 1 } }))
            .rejects.toThrow(/no vault is bound/)
        expect(daemon.receivedCalls).toHaveLength(0)
    })
})
