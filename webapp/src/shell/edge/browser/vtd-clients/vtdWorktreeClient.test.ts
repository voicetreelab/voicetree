// Black-box tests for the typed worktree gateway client. A real loopback
// http.Server speaks JSON-RPC; each test asserts the OBSERVABLE wire I/O — the
// dotted method name, the bearer header, the params body — and that the client
// projects the daemon's response onto the bare value the HostAPI contract
// expects. A JSON-RPC `error` body must make the call throw. No mocks, no
// spies — the wire is the contract.

import {afterEach, describe, expect, it} from 'vitest'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {WORKTREE_METHODS, type WorktreeInfo} from '@vt/vt-daemon-protocol'
import {
    vtdCreateWorktree,
    vtdGenerateWorktreeName,
    vtdListWorktrees,
    vtdRemoveWorktree,
    vtdRemoveWorktreeCommand,
} from './vtdWorktreeClient'

interface Captured {
    method: string
    params: unknown
    auth: string | undefined
}

type RpcReply = {result: unknown} | {error: {code: number; message: string}}

let server: Server | null = null

afterEach(async () => {
    if (server) await new Promise<void>(res => server!.close(() => res()))
    server = null
})

/** Bring up a loopback /rpc server returning `reply`, capturing the request. */
async function bring(reply: RpcReply): Promise<{url: string; last: () => Captured}> {
    let captured: Captured | null = null
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
        let body = ''
        req.on('data', c => { body += c })
        req.on('end', () => {
            const parsed = JSON.parse(body) as {method: string; params: unknown}
            captured = {method: parsed.method, params: parsed.params, auth: req.headers.authorization}
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({jsonrpc: '2.0', id: 1, ...reply}))
        })
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const {port} = server!.address() as AddressInfo
    return {url: `http://127.0.0.1:${port}`, last: () => captured!}
}

describe('vtdWorktreeClient', () => {
    it('listWorktrees posts the dotted method + bearer and returns the array verbatim', async () => {
        const wts: WorktreeInfo[] = [{path: '/wts/wt-a', branch: 'wt-a', head: 'abc123', name: 'a'}]
        const {url, last} = await bring({result: wts})
        const result = await vtdListWorktrees(url, 'tok-123')
        expect(result).toEqual(wts)
        expect(last().method).toBe(WORKTREE_METHODS.list)
        expect(last().method).toBe('worktree.list')
        expect(last().auth).toBe('Bearer tok-123')
        expect(last().params).toEqual({})
    })

    it('createWorktree sends only {worktreeName} (no client path) and unwraps {path}', async () => {
        const {url, last} = await bring({result: {path: '/wts/wt-feature'}})
        const path = await vtdCreateWorktree(url, 'tok', 'wt-feature')
        expect(path).toBe('/wts/wt-feature')
        expect(last().method).toBe('worktree.create')
        expect(last().params).toEqual({worktreeName: 'wt-feature'})
    })

    it('generateWorktreeName carries the title and unwraps {name}', async () => {
        const {url, last} = await bring({result: {name: 'wt-fix-auth-x1y'}})
        const name = await vtdGenerateWorktreeName(url, 'tok', 'Fix Auth')
        expect(name).toBe('wt-fix-auth-x1y')
        expect(last().method).toBe('worktree.generateName')
        expect(last().params).toEqual({nodeTitle: 'Fix Auth'})
    })

    it('removeWorktree carries {worktreePath, force} and returns the result record', async () => {
        const {url, last} = await bring({result: {success: true, command: 'git worktree remove /wts/wt-a'}})
        const res = await vtdRemoveWorktree(url, 'tok', '/wts/wt-a', true)
        expect(res).toEqual({success: true, command: 'git worktree remove /wts/wt-a'})
        expect(last().method).toBe('worktree.remove')
        expect(last().params).toEqual({worktreePath: '/wts/wt-a', force: true})
    })

    it('removeWorktreeCommand carries {worktreePath, force} and unwraps {command}', async () => {
        const {url, last} = await bring({result: {command: 'git worktree remove --force "/wts/wt-a"'}})
        const command = await vtdRemoveWorktreeCommand(url, 'tok', '/wts/wt-a', true)
        expect(command).toBe('git worktree remove --force "/wts/wt-a"')
        expect(last().method).toBe('worktree.removeCommand')
        expect(last().params).toEqual({worktreePath: '/wts/wt-a', force: true})
    })

    it('a JSON-RPC error body makes the call throw', async () => {
        const {url} = await bring({error: {code: -32000, message: 'boom'}})
        await expect(vtdCreateWorktree(url, 'tok', 'wt-x')).rejects.toThrow(/boom/)
    })
})
