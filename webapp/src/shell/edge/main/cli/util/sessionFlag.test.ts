import {describe, expect, it, vi} from 'vitest'
import type {GraphDbClient} from '@vt/graph-db-client'
import {ArgValidationError} from './exitCodes'
import {parseSessionFlag, resolveSessionId} from './sessionFlag'

function makeClient(sessionId: string = 'minted-session'): {
    client: GraphDbClient
    createSession: ReturnType<typeof vi.fn>
} {
    const createSession = vi.fn().mockResolvedValue({sessionId})

    return {
        client: {createSession} as unknown as GraphDbClient,
        createSession,
    }
}

describe('parseSessionFlag', () => {
    it('extracts --session without disturbing the order of other args', () => {
        expect(
            parseSessionFlag(['view', 'collapse', 'folder-1', '--session', 'abc', '--json'])
        ).toEqual({
            remaining: ['view', 'collapse', 'folder-1', '--json'],
            session: 'abc',
        })
    })

    it('returns the original argv when no session flag is present', () => {
        expect(parseSessionFlag(['view', 'show'])).toEqual({
            remaining: ['view', 'show'],
        })
    })

    it('throws ArgValidationError when --session is missing a value', () => {
        expect(() => parseSessionFlag(['view', 'show', '--session'])).toThrowError(
            ArgValidationError
        )
        expect(() => parseSessionFlag(['view', 'show', '--session'])).toThrow(
            '--session requires a non-empty value'
        )
    })

    it('throws ArgValidationError when the next token is another flag', () => {
        expect(() =>
            parseSessionFlag(['view', 'show', '--session', '--vault', '/tmp/vault'])
        ).toThrowError(ArgValidationError)
    })
})

describe('resolveSessionId', () => {
    it('returns the explicit flag and does not mint when both flag and env are provided', async () => {
        const {client, createSession} = makeClient()

        await expect(
            resolveSessionId({flag: 'flag-session', env: 'env-session', client})
        ).resolves.toBe('flag-session')
        expect(createSession).not.toHaveBeenCalled()
    })

    it('returns the environment value when the flag is absent', async () => {
        const {client, createSession} = makeClient()

        await expect(resolveSessionId({env: 'env-session', client})).resolves.toBe(
            'env-session'
        )
        expect(createSession).not.toHaveBeenCalled()
    })

    it('mints a fresh session when neither flag nor env is provided', async () => {
        const {client, createSession} = makeClient('fresh-session')

        await expect(resolveSessionId({client})).resolves.toBe('fresh-session')
        expect(createSession).toHaveBeenCalledTimes(1)
    })

    it('ignores empty env values and still mints a fresh session', async () => {
        const {client, createSession} = makeClient('fresh-session')

        await expect(resolveSessionId({env: '', client})).resolves.toBe('fresh-session')
        expect(createSession).toHaveBeenCalledTimes(1)
    })
})
