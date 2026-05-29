import {describe, expect, it} from 'vitest'
import {createCeremonyStdinDecoder} from './stdin-decoder.js'

function collect(): {submit: (m: string) => void; messages: string[]} {
    const messages: string[] = []
    return {
        submit: (message: string): void => { messages.push(message) },
        messages,
    }
}

function feed(decoder: (chunk: string) => void, parts: readonly string[]): void {
    for (const part of parts) decoder(part)
}

describe('createCeremonyStdinDecoder', (): void => {
    describe('regression detector — naive injection paths must NOT submit', (): void => {
        it('does NOT submit on plain CR (the naive `tmux send-keys ... ; tmux send-keys Enter` path)', (): void => {
            const {submit, messages} = collect()
            const decode = createCeremonyStdinDecoder(submit)
            // This is exactly what the 6fc41313 regression sent:
            //   bytes := <body with embedded \n\n> + <plain CR>
            feed(decode, [
                '[From: A] {"type":"create_nodes","nodes":[{"title":"x","summary":"s"}]}\n\nIf needed, you can reply...\r',
            ])
            expect(messages).toEqual([])
        })

        it('does NOT submit on bare LF', (): void => {
            const {submit, messages} = collect()
            const decode = createCeremonyStdinDecoder(submit)
            feed(decode, ['hello world\n'])
            expect(messages).toEqual([])
        })

        it('does NOT submit on CRLF', (): void => {
            const {submit, messages} = collect()
            const decode = createCeremonyStdinDecoder(submit)
            feed(decode, ['hello\r\n'])
            expect(messages).toEqual([])
        })
    })

    describe('happy path — the inject ceremony submits the body cleanly', (): void => {
        it('submits the bracketed-paste body on Alt+Enter, stripping preamble noise', (): void => {
            const {submit, messages} = collect()
            const decode = createCeremonyStdinDecoder(submit)
            // Exact byte sequence produced by send-text-to-terminal.ts for the
            // body `[From: A] {"type":"create_nodes","nodes":[{"title":"x","summary":"s"}]}`:
            feed(decode, [
                ' ',                                              // preamble dummy
                '\x1b',                                           // ESC (vi normal)
                'i',                                              // vi insert
                '\x15',                                           // Ctrl-U kill-line
                '\x1b[200~',                                      // paste begin
                '[From: A] {"type":"create_nodes","nodes":[{"title":"x","summary":"s"}]}',   // body
                '\x1b[201~',                                      // paste end
                '\x1b\r',                                         // Alt+Enter submit
                '\r',                                             // trailing plain Enter (dual submit)
            ])
            expect(messages).toEqual(['[From: A] {"type":"create_nodes","nodes":[{"title":"x","summary":"s"}]}'])
        })

        it('preserves embedded newlines inside the paste body (and still submits cleanly)', (): void => {
            const {submit, messages} = collect()
            const decode = createCeremonyStdinDecoder(submit)
            feed(decode, [
                '\x1b[200~line1\nline2\nline3\x1b[201~\x1b\r',
            ])
            expect(messages).toEqual(['line1\nline2\nline3'])
        })
    })

    describe('robustness — escape sequences split across chunk boundaries', (): void => {
        it('handles paste-start split between chunks', (): void => {
            const {submit, messages} = collect()
            const decode = createCeremonyStdinDecoder(submit)
            feed(decode, ['\x1b[20', '0~body\x1b[201~\x1b\r'])
            expect(messages).toEqual(['body'])
        })

        it('handles paste-end split between chunks', (): void => {
            const {submit, messages} = collect()
            const decode = createCeremonyStdinDecoder(submit)
            feed(decode, ['\x1b[200~body\x1b[20', '1~\x1b\r'])
            expect(messages).toEqual(['body'])
        })

        it('handles Alt+Enter split between chunks', (): void => {
            const {submit, messages} = collect()
            const decode = createCeremonyStdinDecoder(submit)
            feed(decode, ['\x1b[200~body\x1b[201~', '\x1b', '\r'])
            expect(messages).toEqual(['body'])
        })
    })

    describe('multiple messages on one stream', (): void => {
        it('submits each Alt+Enter-terminated message independently', (): void => {
            const {submit, messages} = collect()
            const decode = createCeremonyStdinDecoder(submit)
            feed(decode, [
                '\x1b[200~first\x1b[201~\x1b\r',
                '\x1b[200~second\x1b[201~\x1b\r',
            ])
            expect(messages).toEqual(['first', 'second'])
        })

        it('Ctrl-U between messages clears in-flight buffer without emitting', (): void => {
            const {submit, messages} = collect()
            const decode = createCeremonyStdinDecoder(submit)
            feed(decode, [
                '\x1b[200~discard-me\x1b[201~',  // body typed but no submit yet
                '\x15',                          // user kills the line
                '\x1b[200~keep-me\x1b[201~\x1b\r',
            ])
            expect(messages).toEqual(['keep-me'])
        })
    })
})
