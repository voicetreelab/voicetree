import {describe, expect, it} from 'vitest'
import type {ProjectState} from '@vt/graph-db-client'
import {buildElectronGraphSnapshot} from './graph-snapshot'

describe('buildElectronGraphSnapshot', () => {
    it('reads project state exactly once at the daemon client boundary', async () => {
        const counters = {
            graphReads: 0,
            projectReads: 0,
        }
        const projectState: ProjectState = {
            projectRoot: '/project',
            readPaths: ['/project/write', '/project/reference'],
            writeFolderPath: '/project/write',
        }

        const snapshot = await buildElectronGraphSnapshot({
            getGraph: async () => {
                counters.graphReads += 1
                return {nodes: {}}
            },
            getProject: async () => {
                counters.projectReads += 1
                return projectState
            },
        })

        expect(counters).toEqual({
            graphReads: 1,
            projectReads: 1,
        })
        expect(snapshot.projectRoot).toBe('/project')
        expect(snapshot.writeFolderPath).toBe('/project/write')
        expect(snapshot.projectPaths).toEqual(['/project/write', '/project/reference'])
    })
})
