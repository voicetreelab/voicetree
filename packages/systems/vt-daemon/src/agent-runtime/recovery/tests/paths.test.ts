import path from 'node:path'
import {describe, expect, it} from 'vitest'

import {getRecoveryMetadataDir} from '../paths'

describe('getRecoveryMetadataDir', () => {
    it('returns <projectRoot>/.voicetree/terminals', () => {
        expect(getRecoveryMetadataDir('/a/b')).toBe(path.join('/a/b', '.voicetree', 'terminals'))
    })

    it('preserves nested project roots without normalising parent traversal', () => {
        const nested = '/Users/alice/Voicetree/outer/inner'
        expect(getRecoveryMetadataDir(nested)).toBe(path.join(nested, '.voicetree', 'terminals'))
    })
})
