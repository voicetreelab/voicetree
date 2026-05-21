/**
 * BF-200 — integration tests for live focus/neighbors/path (Step 7c, UDS).
 *
 * Boots the headless UDS daemon with a fixture vault, then calls
 * liveFocus / liveNeighbors / livePath via the transport layer.
 */
import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {mkdirSync, mkdtempSync, writeFileSync, rmSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {createHeadlessServer, type HeadlessServer} from '../src/live/headlessServer'
import {liveFocus, liveNeighbors, livePath} from '../src/live/live'

const VAULT = '/tmp/vt-bf200-obs-test'
const A = `${VAULT}/a.md`
const B = `${VAULT}/b.md`
const C = `${VAULT}/c.md`
const D = `${VAULT}/d.md`

let server: HeadlessServer
let savedSockEnv: string | undefined

beforeAll(async () => {
    mkdirSync(VAULT, {recursive: true})
    writeFileSync(A, '# A\n[[b]]\n')
    writeFileSync(B, '# B\n[[c]]\n')
    writeFileSync(C, '# C\n')
    writeFileSync(D, '# D\n') // isolated

    const sockDir = mkdtempSync(join(tmpdir(), 'vt-bf200-obs-'))
    const socketPath = join(sockDir, 'vt.sock')
    server = await createHeadlessServer({socketPath, vaultPath: VAULT})

    savedSockEnv = process.env.VOICETREE_SOCK_PATH
    process.env.VOICETREE_SOCK_PATH = server.socketPath
})

afterAll(async () => {
    await server.close()
    if (savedSockEnv === undefined) delete process.env.VOICETREE_SOCK_PATH
    else process.env.VOICETREE_SOCK_PATH = savedSockEnv
    rmSync(VAULT, {recursive: true, force: true})
})

describe('liveFocus()', () => {
    it('returns ASCII with center and neighbors', async () => {
        const out = await liveFocus(B, {hops: 1})
        expect(out).toContain('b.md')
        expect(out).toContain('a.md')
        expect(out).toContain('c.md')
        expect(out.length).toBeGreaterThan(10)
    })

    it('missing node reports not found', async () => {
        const out = await liveFocus('/nonexistent/x.md')
        expect(out).toContain('not found')
    })
})

describe('liveNeighbors()', () => {
    it('1-hop returns direct neighbors', async () => {
        const out = await liveNeighbors(B, {hops: 1})
        expect(out).toContain('a.md')
        expect(out).toContain('c.md')
    })

    it('2-hop from a reaches c', async () => {
        const out = await liveNeighbors(A, {hops: 2})
        expect(out).toContain('c.md')
    })

    it('isolated node has 0 neighbors', async () => {
        const out = await liveNeighbors(D, {hops: 1})
        expect(out).toContain('0 found')
    })
})

describe('livePath()', () => {
    it('finds path a → b → c', async () => {
        const out = await livePath(A, C)
        expect(out).toBe('a.md → b.md → c.md')
    })

    it('no path from a to isolated d', async () => {
        const out = await livePath(A, D)
        expect(out).toContain('no path')
    })

    it('self path is just the node', async () => {
        const out = await livePath(B, B)
        expect(out).toBe('b.md')
    })
})
