import { describe, expect, test } from 'vitest'
import { prewarmGraphdRuntimeCommand } from './prewarm-graphd-runtime'

/** Records what the prewarm logs, so we assert on observable output not calls. */
function makeRecordingLogger(): {
    readonly logger: { info: (m: string) => void; warn: (m: string) => void }
    readonly info: string[]
    readonly warn: string[]
} {
    const info: string[] = []
    const warn: string[] = []
    return { logger: { info: (m) => info.push(m), warn: (m) => warn.push(m) }, info, warn }
}

describe('prewarmGraphdRuntimeCommand', () => {
    test('resolves the runtime command once and logs the resolved binary', () => {
        const { logger, info, warn } = makeRecordingLogger()
        let resolveCalls = 0
        prewarmGraphdRuntimeCommand({
            resolve: () => { resolveCalls++; return '/usr/bin/node' },
            defer: (fn) => fn(), // run synchronously so the test observes the effect
            logger,
        })
        expect(resolveCalls).toBe(1)
        expect(info.some((m) => m.includes('/usr/bin/node'))).toBe(true)
        expect(warn).toEqual([])
    })

    test('a probe failure is swallowed (never throws) and surfaced as a warning', () => {
        const { logger, info, warn } = makeRecordingLogger()
        expect(() =>
            prewarmGraphdRuntimeCommand({
                resolve: () => { throw new Error('no node:sqlite runtime') },
                defer: (fn) => fn(),
                logger,
            }),
        ).not.toThrow()
        expect(info).toEqual([])
        expect(warn.some((m) => m.includes('no node:sqlite runtime'))).toBe(true)
    })

    test('defers the probe off the calling tick (does not run inline by default-shape)', () => {
        const { logger } = makeRecordingLogger()
        let ran = false
        prewarmGraphdRuntimeCommand({
            resolve: () => { ran = true; return 'node' },
            defer: () => { /* never invoke → models setImmediate not yet fired */ },
            logger,
        })
        expect(ran).toBe(false) // the probe is scheduled, not run on the boot tick
    })
})
