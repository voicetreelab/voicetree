import {describe, it, expect, beforeEach} from 'vitest'
import {captureOutput, getOutput, clearBuffer, clearAllBuffers} from './terminal-output-buffer'

describe('terminal-output-buffer', () => {
    beforeEach(() => {
        clearAllBuffers()
    })

    describe('sanitizeOutput via captureOutput', () => {
        it('preserves plain text', () => {
            captureOutput('t1', 'hello world\n')
            expect(getOutput('t1', 1000)).toBe('hello world\n')
        })

        it('strips CSI sequences (colors, cursor movement)', () => {
            // ESC[31m = red, ESC[0m = reset
            captureOutput('t1', '\x1B[31mred text\x1B[0m\n')
            expect(getOutput('t1', 1000)).toBe('red text\n')
        })

        it('strips OSC 8 hyperlink sequences', () => {
            // OSC 8 hyperlink: ESC]8;;url BEL text ESC]8;; BEL
            captureOutput('t1', '\x1B]8;;https://example.com\x07link text\x1B]8;;\x07\n')
            expect(getOutput('t1', 1000)).toBe('link text\n')
        })

        it('strips OSC 0 title sequences', () => {
            // ESC]0;title BEL
            captureOutput('t1', '\x1B]0;My Terminal Title\x07\nactual content\n')
            expect(getOutput('t1', 1000)).toBe('\nactual content\n')
        })

        it('strips OSC 133 shell integration sequences', () => {
            captureOutput('t1', '\x1B]133;A\x07$ ls\n\x1B]133;B\x07file.txt\n')
            expect(getOutput('t1', 1000)).toBe('$ ls\nfile.txt\n')
        })

        it('strips OSC sequences terminated by ST (ESC backslash)', () => {
            captureOutput('t1', '\x1B]0;title\x1B\\\ntext\n')
            expect(getOutput('t1', 1000)).toBe('\ntext\n')
        })

        it('strips unterminated OSC sequences (body consumed up to newline)', () => {
            // OSC without BEL or ST — body is consumed until newline boundary
            captureOutput('t1', 'before\x1B]8;;some_url\nafter\n')
            expect(getOutput('t1', 1000)).toBe('before\nafter\n')
        })

        it('handles CRLF line endings', () => {
            captureOutput('t1', 'line one\r\nline two\r\n')
            expect(getOutput('t1', 1000)).toBe('line one\nline two\n')
        })

        it('processes carriage return overwrites from TUI apps', () => {
            // TUI apps use \r to overwrite the current line in-place
            captureOutput('t1', 'Waiting for response...\rProcessing query...\rDone!\n')
            expect(getOutput('t1', 1000)).toBe('Done!\n')
        })

        it('strips 8-bit C1 control codes', () => {
            captureOutput('t1', 'hello\x9Bworld\n')
            expect(getOutput('t1', 1000)).toBe('helloworld\n')
        })

        it('filters non-printable characters but keeps newlines', () => {
            captureOutput('t1', 'hello\x01\x02\x03world\n')
            expect(getOutput('t1', 1000)).toBe('helloworld\n')
        })

        it('does NOT strip backslashes in normal content', () => {
            captureOutput('t1', '/Users/bob\\repos\\file.ts\n')
            expect(getOutput('t1', 1000)).toBe('/Users/bob\\repos\\file.ts\n')
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
            expect(getOutput('t1', 1000)).toBe('$ myfile.ts bold \n')
        })
    })

    describe('character buffer behavior', () => {
        it('returns undefined for unknown terminal', () => {
            expect(getOutput('unknown', 100)).toBeUndefined()
        })

        it('captures text with newlines preserved', () => {
            captureOutput('t1', 'line 1\nline 2\nline 3\n')
            expect(getOutput('t1', 1000)).toBe('line 1\nline 2\nline 3\n')
        })

        it('handles partial data across captures', () => {
            captureOutput('t1', 'partial')
            captureOutput('t1', ' line\nfull line\n')
            expect(getOutput('t1', 1000)).toBe('partial line\nfull line\n')
        })

        it('respects nChars limit', () => {
            captureOutput('t1', 'abcdefghij')
            expect(getOutput('t1', 5)).toBe('fghij')
        })

        it('trims from front when exceeding max buffer size', () => {
            // Capture more than would fit in a small test — test the trim logic
            const chunk: string = 'x'.repeat(6000)
            captureOutput('t1', chunk)
            captureOutput('t1', chunk)
            const output: string | undefined = getOutput('t1', 20000)
            // Buffer max is 10000 chars, so 12000 input should be trimmed to 10000
            expect(output?.length).toBe(10000)
        })

        it('clears buffer for specific terminal', () => {
            captureOutput('t1', 'data\n')
            captureOutput('t2', 'data\n')
            clearBuffer('t1')
            expect(getOutput('t1', 100)).toBeUndefined()
            expect(getOutput('t2', 100)).toBe('data\n')
        })
    })

    describe('realistic Claude Code terminal output', () => {
        // Raw terminal data representative of what read_terminal_output captures
        // from a Claude Code session — mix of CSI color codes, OSC shell integration,
        // 256-color sequences, bold, and reset sequences
        const REALISTIC_CHUNK: string =
            '\x1B[48;5;234m\x1B[38;5;250m Now let me update the MCP server registration \x1B[0m\n' +
            '\x1B[38;5;2m+\x1B[0m     nChars: z.number().optional().describe(\'Number of characters\')\n' +
            '\x1B[48;5;234m\x1B[38;5;250m 10 export interface ReadTerminal\x1B[0m\n' +
            '\x1B[38;5;2m+\x1B[0m    const output: string\x1B[38;5;240m | undefined\x1B[0m = getOutput(terminalId, nChars)\n' +
            '\x1B[38;5;2m+\x1B[0m        nChars,                                 \n' +
            '\x1B[38;5;1m-\x1B[0m            expect(getOutput(\'t1\', 10)).toBe(\'hello world\')\n' +
            '\x1B[38;5;2m+\x1B[0m            expect(getOutput(\'t1\', 1000)).toBe(\'hello world\\n\')\n' +
            '\x1B]133;A\x07\x1B[32m$ \x1B[0mnpx vitest run src/shell/edge/main/terminals/terminal-output-buffer.test.ts\n' +
            '\x1B]133;B\x07 RUN  v3.2.4 /Users/bobbobby/repos/voicetree-public/webapp\n' +
            ' \x1B[32m\u2713\x1B[0m src/shell/edge/main/terminals/terminal-output-buffer.test.ts (21 tests) 5ms\n' +
            '\n' +
            ' Test Files  \x1B[1m\x1B[32m1 passed\x1B[0m (1)\n' +
            '      Tests  \x1B[1m\x1B[32m21 passed\x1B[0m (21)\n' +
            '   Start at  16:16:34\n' +
            '   Duration  734ms (transform 44ms, setup 132ms, collect 16ms, tests 5ms, environment 437ms, prepare 38ms)\n'

        const EXPECTED_CLEAN: string =
            ' Now let me update the MCP server registration \n' +
            '+     nChars: z.number().optional().describe(\'Number of characters\')\n' +
            ' 10 export interface ReadTerminal\n' +
            '+    const output: string | undefined = getOutput(terminalId, nChars)\n' +
            '+        nChars,                                 \n' +
            '-            expect(getOutput(\'t1\', 10)).toBe(\'hello world\')\n' +
            '+            expect(getOutput(\'t1\', 1000)).toBe(\'hello world\\n\')\n' +
            '$ npx vitest run src/shell/edge/main/terminals/terminal-output-buffer.test.ts\n' +
            ' RUN  v3.2.4 /Users/bobbobby/repos/voicetree-public/webapp\n' +
            '  src/shell/edge/main/terminals/terminal-output-buffer.test.ts (21 tests) 5ms\n' +
            '\n' +
            ' Test Files  1 passed (1)\n' +
            '      Tests  21 passed (21)\n' +
            '   Start at  16:16:34\n' +
            '   Duration  734ms (transform 44ms, setup 132ms, collect 16ms, tests 5ms, environment 437ms, prepare 38ms)\n'

        it('strips all ANSI from realistic Claude Code output', () => {
            captureOutput('t1', REALISTIC_CHUNK)
            const output: string | undefined = getOutput('t1', 10000)
            expect(output).toBe(EXPECTED_CLEAN)
        })

        it('contains no escape characters after sanitization', () => {
            captureOutput('t1', REALISTIC_CHUNK)
            const output: string | undefined = getOutput('t1', 10000)
            // eslint-disable-next-line no-control-regex
            expect(output).not.toMatch(/\x1B/)
            // eslint-disable-next-line no-control-regex
            expect(output).not.toMatch(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/)
        })

        it('handles repeated captures accumulating characters', () => {
            captureOutput('t1', REALISTIC_CHUNK)
            captureOutput('t1', REALISTIC_CHUNK)
            captureOutput('t1', REALISTIC_CHUNK)
            const output: string | undefined = getOutput('t1', 10000)
            expect(output).toBe((EXPECTED_CLEAN + EXPECTED_CLEAN + EXPECTED_CLEAN).slice(-10000))
        })

        it('returns correct nChars slice from accumulated realistic output', () => {
            captureOutput('t1', REALISTIC_CHUNK)
            captureOutput('t1', REALISTIC_CHUNK)
            const fullOutput: string | undefined = getOutput('t1', 10000)
            const last200: string | undefined = getOutput('t1', 200)
            expect(last200).toBe(fullOutput?.slice(-200))
        })
    })

    describe('consecutive empty line collapsing', () => {
        it('collapses multiple consecutive empty lines', () => {
            captureOutput('t1', 'hello\n\n\n\n\nworld\n')
            const output: string | undefined = getOutput('t1', 5000)
            expect(output).toBe('hello\n\nworld\n')
        })

        it('preserves single empty lines', () => {
            captureOutput('t1', 'a\n\nb\n\nc\n')
            expect(getOutput('t1', 5000)).toBe('a\n\nb\n\nc\n')
        })
    })
})
