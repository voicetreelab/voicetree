import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
    dialog: {
        showOpenDialog: vi.fn(),
    },
}))

import { getDefaultProjectsHomePath } from './show-folder-picker'

describe('getDefaultProjectsHomePath', () => {
    it('uses ~/Voicetree as the default parent for newly-created projects', () => {
        expect(getDefaultProjectsHomePath('/home/aki')).toBe('/home/aki/Voicetree')
    })
})
