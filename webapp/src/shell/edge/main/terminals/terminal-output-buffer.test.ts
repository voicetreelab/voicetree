import {describe, it, expect, beforeEach} from 'vitest'
import {captureOutput, getOutput, clearBuffer, clearAllBuffers} from './terminal-output-buffer'

describe('terminal-output-buffer', () => {
    beforeEach(() => {
        clearAllBuffers()
    })

    describe('sanitizeOutput via captureOutput', () => {
        it('preserves plain text', () => {
            captureOutput('t1', 'hello world\n')
            expect(getOutput('t1', 10)).toBe('hello world')
        })

        it('strips CSI sequences (colors, cursor movement)', () => {
            // ESC[31m = red, ESC[0m = reset
            captureOutput('t1', '\x1B[31mred text\x1B[0m\n')
            expect(getOutput('t1', 10)).toBe('red text')
        })

        it('strips OSC 8 hyperlink sequences', () => {
            // OSC 8 hyperlink: ESC]8;;url BEL text ESC]8;; BEL
            captureOutput('t1', '\x1B]8;;https://example.com\x07link text\x1B]8;;\x07\n')
            expect(getOutput('t1', 10)).toBe('link text')
        })

        it('strips OSC 0 title sequences', () => {
            // ESC]0;title BEL
            captureOutput('t1', '\x1B]0;My Terminal Title\x07\nactual content\n')
            expect(getOutput('t1', 10)).toBe('\nactual content')
        })

        it('strips OSC 133 shell integration sequences', () => {
            captureOutput('t1', '\x1B]133;A\x07$ ls\n\x1B]133;B\x07file.txt\n')
            expect(getOutput('t1', 10)).toBe('$ ls\nfile.txt')
        })

        it('strips OSC sequences terminated by ST (ESC backslash)', () => {
            captureOutput('t1', '\x1B]0;title\x1B\\\ntext\n')
            expect(getOutput('t1', 10)).toBe('\ntext')
        })

        it('strips unterminated OSC sequences (body consumed up to newline)', () => {
            // OSC without BEL or ST — body is consumed until newline boundary
            captureOutput('t1', 'before\x1B]8;;some_url\nafter\n')
            expect(getOutput('t1', 10)).toBe('before\nafter')
        })

        it('handles CRLF line endings', () => {
            captureOutput('t1', 'line one\r\nline two\r\n')
            expect(getOutput('t1', 10)).toBe('line one\nline two')
        })

        it('processes carriage return overwrites from TUI apps', () => {
            // TUI apps use \r to overwrite the current line in-place
            captureOutput('t1', 'Waiting for response...\rProcessing query...\rDone!\n')
            expect(getOutput('t1', 10)).toBe('Done!')
        })

        it('strips 8-bit C1 control codes', () => {
            captureOutput('t1', 'hello\x9Bworld\n')
            expect(getOutput('t1', 10)).toBe('helloworld')
        })

        it('filters non-printable characters but keeps newlines', () => {
            captureOutput('t1', 'hello\x01\x02\x03world\n')
            expect(getOutput('t1', 10)).toBe('helloworld')
        })

        it('does NOT strip backslashes in normal content', () => {
            captureOutput('t1', '/Users/bob\\repos\\file.ts\n')
            expect(getOutput('t1', 10)).toBe('/Users/bob\\repos\\file.ts')
        })

        it('handles complex Claude Code-like output with mixed sequences', () => {
            const complexOutput: string =
                '\x1B]133;A\x07' +          // shell integration
                '\x1B[32m$ \x1B[0m' +       // green prompt
                '\x1B]8;;file:///path\x07' + // hyperlink start
                'myfile.ts' +                // visible text
                '\x1B]8;;\x07' +             // hyperlink end
                '\x1B[1m bold \x1B[0m' +     // bold
                '\n'
            captureOutput('t1', complexOutput)
            expect(getOutput('t1', 10)).toBe('$ myfile.ts bold ')
        })
    })

    describe('ring buffer behavior', () => {
        it('returns undefined for unknown terminal', () => {
            expect(getOutput('unknown', 10)).toBeUndefined()
        })

        it('captures multiple lines', () => {
            captureOutput('t1', 'line 1\nline 2\nline 3\n')
            expect(getOutput('t1', 10)).toBe('line 1\nline 2\nline 3')
        })

        it('handles partial lines across captures', () => {
            captureOutput('t1', 'partial')
            captureOutput('t1', ' line\nfull line\n')
            expect(getOutput('t1', 10)).toBe('partial line\nfull line')
        })

        it('respects nLines limit', () => {
            captureOutput('t1', 'a\nb\nc\nd\ne\n')
            expect(getOutput('t1', 2)).toBe('d\ne')
        })

        it('clears buffer for specific terminal', () => {
            captureOutput('t1', 'data\n')
            captureOutput('t2', 'data\n')
            clearBuffer('t1')
            expect(getOutput('t1', 10)).toBeUndefined()
            expect(getOutput('t2', 10)).toBe('data')
        })
    })

    describe('consecutive empty line collapsing', () => {
        it('collapses multiple consecutive empty lines', () => {
            captureOutput('t1', 'hello\n\n\n\n\nworld\n')
            const output: string | undefined = getOutput('t1', 50)
            expect(output).toBe('hello\n\nworld')
        })

        it('preserves single empty lines', () => {
            captureOutput('t1', 'a\n\nb\n\nc\n')
            expect(getOutput('t1', 50)).toBe('a\n\nb\n\nc')
        })
    })
})
