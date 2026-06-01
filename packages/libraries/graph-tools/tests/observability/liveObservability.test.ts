/**
 * BF-200 — integration tests for live focus/neighbors/path (Step 9d, HTTP).
 *
 * Boots the headless HTTP daemon with a fixture project, then calls
 * liveFocus / liveNeighbors / livePath via the transport layer.
 */
import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {mkdirSync, writeFileSync, rmSync} from 'fs'
import {createHeadlessServer, type HeadlessServer} from '../../src/live/headlessServer'
import {liveFocus, liveNeighbors, livePath} from '../../src/live/live'

const PROJECT = '/tmp/vt-bf200-obs-test'
const A = `${PROJECT}/a.md`
const B = `${PROJECT}/b.md`
const C = `${PROJECT}/c.md`
const D = `${PROJECT}/d.md`

let server: HeadlessServer
let savedProjectEnv: string | undefined
let savedUrlEnv: string | undefined

beforeAll(async () => {
    mkdirSync(PROJECT, {recursive: true})
    mkdirSync(`${PROJECT}/.voicetree`, {recursive: true})
    writeFileSync(A, '# A\n[[b]]\n')
    writeFileSync(B, '# B\n[[c]]\n')
    writeFileSync(C, '# C\n')
    writeFileSync(D, '# D\n') // isolated

    server = await createHeadlessServer({projectPath: PROJECT})

    savedProjectEnv = process.env.VOICETREE_PROJECT_PATH
    savedUrlEnv = process.env.VOICETREE_DAEMON_URL
    process.env.VOICETREE_PROJECT_PATH = server.projectPath
    delete process.env.VOICETREE_DAEMON_URL
})

afterAll(async () => {
    await server.close()
    if (savedProjectEnv === undefined) delete process.env.VOICETREE_PROJECT_PATH
    else process.env.VOICETREE_PROJECT_PATH = savedProjectEnv
    if (savedUrlEnv === undefined) delete process.env.VOICETREE_DAEMON_URL
    else process.env.VOICETREE_DAEMON_URL = savedUrlEnv
    rmSync(PROJECT, {recursive: true, force: true})
})

describe('liveFocus()', () => {
    it('returns ASCII with center and neighbors', async () => {
        const out = await liveFocus(B, {hops: 1})
        expect(out.kind).toBe('ok')
        expect(out.text).toContain('b.md')
        expect(out.text).toContain('a.md')
        expect(out.text).toContain('c.md')
        expect(out.text.length).toBeGreaterThan(10)
    })

    it('missing node reports not found', async () => {
        const out = await liveFocus('/nonexistent/x.md')
        expect(out.kind).toBe('not-found')
        expect(out.text).toContain('not found')
    })
})

describe('liveNeighbors()', () => {
    it('1-hop returns direct neighbors', async () => {
        const out = await liveNeighbors(B, {hops: 1})
        expect(out.kind).toBe('ok')
        expect(out.text).toContain('a.md')
        expect(out.text).toContain('c.md')
    })

    it('2-hop from a reaches c', async () => {
        const out = await liveNeighbors(A, {hops: 2})
        expect(out.text).toContain('c.md')
    })

    it('isolated node has 0 neighbors', async () => {
        const out = await liveNeighbors(D, {hops: 1})
        expect(out.text).toContain('0 found')
    })
})

describe('livePath()', () => {
    it('finds path a → b → c', async () => {
        const out = await livePath(A, C)
        expect(out.kind).toBe('ok')
        expect(out.text).toBe('a.md → b.md → c.md')
    })

    it('no path from a to isolated d is distinct from an unknown endpoint', async () => {
        const out = await livePath(A, D)
        expect(out.kind).toBe('no-path')
        expect(out.text).toContain('no path')
    })

    it('unknown endpoint reports not found (distinct from no-path)', async () => {
        const out = await livePath(A, '/nonexistent/x.md')
        expect(out.kind).toBe('not-found')
        expect(out.text).toContain('not found')
    })

    it('self path is just the node', async () => {
        const out = await livePath(B, B)
        expect(out.kind).toBe('ok')
        expect(out.text).toBe('b.md')
    })
})
