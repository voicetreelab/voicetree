import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {describe, expect, it} from 'vitest'
import {getTmuxSocketPath} from './tmux-server'

const expectedFallback = (appSupportPath: string): string => {
    const hash: string = createHash('sha256').update(appSupportPath).digest('hex').slice(0, 8)
    return join(tmpdir(), `vt-${hash}.sock`)
}

describe('getTmuxSocketPath', () => {
    it('returns <appSupportPath>/tmux.sock for paths within the AF_UNIX byte limit', () => {
        const appSupportPath = '/tmp/short-path'
        expect(getTmuxSocketPath(appSupportPath)).toBe('/tmp/short-path/tmux.sock')
    })

    it('falls back to a short hashed path under tmpdir when the natural path overflows the byte limit', () => {
        const appSupportPath = '/' + 'a'.repeat(140)
        const result = getTmuxSocketPath(appSupportPath)
        expect(result).toBe(expectedFallback(appSupportPath))
        expect(result).toMatch(/\/vt-[0-9a-f]{8}\.sock$/)
    })

    it('produces a fallback path whose byte length stays comfortably under both platform limits', () => {
        const appSupportPath = '/' + 'a'.repeat(200)
        const result = getTmuxSocketPath(appSupportPath)
        expect(Buffer.byteLength(result, 'utf8')).toBeLessThan(103)
    })

    it('is deterministic: the same input always produces the same output', () => {
        const appSupportPath = '/' + 'b'.repeat(140)
        expect(getTmuxSocketPath(appSupportPath)).toBe(getTmuxSocketPath(appSupportPath))
    })

    it('different overflowing inputs produce different fallback paths', () => {
        const a = '/' + 'a'.repeat(140)
        const b = '/' + 'b'.repeat(140)
        expect(getTmuxSocketPath(a)).not.toBe(getTmuxSocketPath(b))
    })

    it('uses utf-8 BYTE length, not character count, when deciding the fallback', () => {
        // 35 multi-byte characters at 3 bytes each = 105 bytes; plus '/' and '/tmux.sock' (10) = 116 bytes.
        // string.length is 46; Buffer.byteLength is 116 — must fall back.
        const appSupportPath = '/' + '✓'.repeat(35)
        const result = getTmuxSocketPath(appSupportPath)
        expect(result).toMatch(/\/vt-[0-9a-f]{8}\.sock$/)
    })
})
