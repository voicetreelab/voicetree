// Black-box tests for the capability records + accessor. Documents intent and
// guards against drift between the two adapters.

import {afterEach, describe, expect, it} from 'vitest'
import {
    BROWSER_CAPABILITIES,
    ELECTRON_CAPABILITIES,
    hostCapabilities,
    type RuntimeCapabilities,
} from './runtimeCapabilities'

const KEYS: readonly (keyof RuntimeCapabilities)[] = [
    'nativeFolderPicker', 'worktrees', 'clipboardImages', 'settingsPersistence',
    'usageObservability', 'nativeMicrophoneSettings', 'askMode',
]

describe('capability records', () => {
    it('Electron supports every native capability', () => {
        expect(KEYS.every(k => ELECTRON_CAPABILITIES[k])).toBe(true)
    })

    it('the browser supports none of them', () => {
        expect(KEYS.some(k => BROWSER_CAPABILITIES[k])).toBe(false)
    })

    it('both records declare exactly the same keys (no drift)', () => {
        expect(Object.keys(BROWSER_CAPABILITIES).sort()).toEqual(Object.keys(ELECTRON_CAPABILITIES).sort())
    })
})

describe('hostCapabilities', () => {
    afterEach(() => {
        delete (window as unknown as {hostAPI?: unknown}).hostAPI
    })

    it('reads capabilities off the installed host adapter', () => {
        ;(window as unknown as {hostAPI: {capabilities: RuntimeCapabilities}}).hostAPI =
            {capabilities: BROWSER_CAPABILITIES}
        expect(hostCapabilities()).toBe(BROWSER_CAPABILITIES)
    })

    it('defaults to the full Electron set when no adapter is installed', () => {
        expect(hostCapabilities()).toBe(ELECTRON_CAPABILITIES)
    })
})
