import { describe, expect, it } from 'vitest'

import { loadProjection, listSnapshotDocuments } from '../src/fixtures.ts'
import { project } from '../src/project.ts'

const snapshots = listSnapshotDocuments()

describe('project()', () => {
    it('has a golden projection for every snapshot fixture', () => {
        expect(snapshots).toHaveLength(25)
    })

    for (const { doc, state } of snapshots) {
        it(`matches the committed projection for ${doc.id}`, () => {
            expect(project(state)).toEqual(loadProjection(doc.id))
        })
    }
})
