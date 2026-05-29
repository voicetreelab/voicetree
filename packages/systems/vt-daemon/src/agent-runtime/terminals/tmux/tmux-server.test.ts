import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {describe, expect, it} from 'vitest'
import {getTmuxSocketPath} from './tmux-server'

const expectedFallback = (voicetreeHomePath: string): string => {
    const hash: string = createHash('sha256').update(voicetreeHomePath).digest('hex').slice(0, 8)
    return join(tmpdir(), `vt-${hash}.sock`)
}

describe('getTmuxSocketPath', () => {
    it('returns <voicetreeHomePath>/tmux.sock for paths within the AF_UNIX byte limit', () => {
        const voicetreeHomePath = '/tmp/short-path'
        expect(getTmuxSocketPath(voicetreeHomePath)).toBe('/tmp/short-path/tmux.sock')
    })

    it('falls back to a short hashed path under tmpdir when the natural path overflows the byte limit', () => {
        const voicetreeHomePath = '/' + 'a'.repeat(140)
        const result = getTmuxSocketPath(voicetreeHomePath)
        expect(result).toBe(expectedFallback(voicetreeHomePath))
        expect(result).toMatch(/\/vt-[0-9a-f]{8}\.sock$/)
    })

    it('produces a fallback path whose byte length stays comfortably under both platform limits', () => {
        const voicetreeHomePath = '/' + 'a'.repeat(200)
        const result = getTmuxSocketPath(voicetreeHomePath)
        expect(Buffer.byteLength(result, 'utf8')).toBeLessThan(103)
    })

    it('is deterministic: the same input always produces the same output', () => {
        const voicetreeHomePath = '/' + 'b'.repeat(140)
        expect(getTmuxSocketPath(voicetreeHomePath)).toBe(getTmuxSocketPath(voicetreeHomePath))
    })

    it('different overflowing inputs produce different fallback paths', () => {
        const a = '/' + 'a'.repeat(140)
        const b = '/' + 'b'.repeat(140)
        expect(getTmuxSocketPath(a)).not.toBe(getTmuxSocketPath(b))
    })

    it('uses utf-8 BYTE length, not character count, when deciding the fallback', () => {
        // 35 multi-byte characters at 3 bytes each = 105 bytes; plus '/' and '/tmux.sock' (10) = 116 bytes.
        // string.length is 46; Buffer.byteLength is 116 — must fall back.
        const voicetreeHomePath = '/' + '✓'.repeat(35)
        const result = getTmuxSocketPath(voicetreeHomePath)
        expect(result).toMatch(/\/vt-[0-9a-f]{8}\.sock$/)
    })
})
