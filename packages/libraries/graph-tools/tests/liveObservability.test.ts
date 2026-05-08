/**
 * BF-200 — integration tests for live focus/neighbors/path.
 *
 * Boots createHeadlessServer with a small fixture vault, then calls
 * liveFocus / liveNeighbors / livePath via the transport layer.
 * Port 3002 is never bound.
 */
import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {mkdirSync, writeFileSync, rmSync} from 'fs'
import {createHeadlessServer, type HeadlessServer} from '../src/headlessServer'
import {liveFocus, liveNeighbors, livePath} from '../src/live'

const VAULT = '/tmp/vt-bf200-obs-test'
const A = `${VAULT}/a.md`
const B = `${VAULT}/b.md`
const C = `${VAULT}/c.md`
const D = `${VAULT}/d.md`

let server: HeadlessServer

beforeAll(async () => {
    mkdirSync(VAULT, {recursive: true})
    writeFileSync(A, '# A\n[[b]]\n')
    writeFileSync(B, '# B\n[[c]]\n')
    writeFileSync(C, '# C\n')
    writeFileSync(D, '# D\n') // isolated
    server = await createHeadlessServer({vaultPath: VAULT})
    expect(server.port).not.toBe(3002)
    expect(server.port).not.toBe(0)
})

afterAll(async () => {
    await server.close()
    rmSync(VAULT, {recursive: true, force: true})
})

describe('liveFocus()', () => {
    it('returns ASCII with center and neighbors', async () => {
        const out = await liveFocus(B, {port: server.port, hops: 1})
        expect(out).toContain('b.md')
        expect(out).toContain('a.md')
        expect(out).toContain('c.md')
        expect(out.length).toBeGreaterThan(10)
    })

    it('missing node reports not found', async () => {
        const out = await liveFocus('/nonexistent/x.md', {port: server.port})
        expect(out).toContain('not found')
    })
})

describe('liveNeighbors()', () => {
    it('1-hop returns direct neighbors', async () => {
        const out = await liveNeighbors(B, {port: server.port, hops: 1})
        expect(out).toContain('a.md')
        expect(out).toContain('c.md')
    })

    it('2-hop from a reaches c', async () => {
        const out = await liveNeighbors(A, {port: server.port, hops: 2})
        expect(out).toContain('c.md')
    })

    it('isolated node has 0 neighbors', async () => {
        const out = await liveNeighbors(D, {port: server.port, hops: 1})
        expect(out).toContain('0 found')
    })
})

describe('livePath()', () => {
    it('finds path a → b → c', async () => {
        const out = await livePath(A, C, {port: server.port})
        expect(out).toBe('a.md → b.md → c.md')
    })

    it('no path from a to isolated d', async () => {
        const out = await livePath(A, D, {port: server.port})
        expect(out).toContain('no path')
    })

    it('self path is just the node', async () => {
        const out = await livePath(B, B, {port: server.port})
        expect(out).toBe('b.md')
    })
})
