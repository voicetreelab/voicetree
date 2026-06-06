import {describe, expect, it} from 'vitest'
import path from 'node:path'
import {canonicalLinkText} from '../../src/authoring/linkForm'

describe('canonicalLinkText', () => {
    it('uses bare links for same-folder targets', () => {
        const root = '/project'
        expect(canonicalLinkText(
            path.join(root, 'docs', 'source.md'),
            path.join(root, 'docs', 'target.md'),
            root,
        )).toBe('target')
    })

    it('uses extensionless project-relative links for cross-folder targets', () => {
        const root = '/project'
        expect(canonicalLinkText(
            path.join(root, 'source.md'),
            path.join(root, 'docs', 'target.md'),
            root,
        )).toBe('docs/target')
    })

    it('collapses a formerly project-relative target after reunion in the same folder', () => {
        const root = '/project'
        expect(canonicalLinkText(
            path.join(root, 'archive', 'source.md'),
            path.join(root, 'archive', 'target.md'),
            root,
        )).toBe('target')
    })
})
