import {describe, expect, it} from 'vitest'
import {terminalRuntimeSurface} from './terminalRuntimeSurface'

describe('terminalRuntimeSurface', () => {
    it('exposes tmux server shutdown for Electron quit cleanup', () => {
        expect(typeof terminalRuntimeSurface.shutdownTmuxServer).toBe('function')
    })
})
