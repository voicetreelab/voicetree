import {describe, expect, it} from 'vitest'
import type {VaultState} from '@vt/graph-db-client'
import {buildElectronGraphSnapshot} from './graph-snapshot'

describe('buildElectronGraphSnapshot', () => {
    it('reads vault state exactly once at the daemon client boundary', async () => {
        const counters = {
            graphReads: 0,
            vaultReads: 0,
        }
        const vaultState: VaultState = {
            projectRoot: '/project',
            readPaths: ['/project/write', '/project/reference'],
            writeFolderPath: '/project/write',
        }

        const snapshot = await buildElectronGraphSnapshot({
            getGraph: async () => {
                counters.graphReads += 1
                return {nodes: {}}
            },
            getVault: async () => {
                counters.vaultReads += 1
                return vaultState
            },
        })

        expect(counters).toEqual({
            graphReads: 1,
            vaultReads: 1,
        })
        expect(snapshot.projectRoot).toBe('/project')
        expect(snapshot.writeFolderPath).toBe('/project/write')
        expect(snapshot.vaultPaths).toEqual(['/project/write', '/project/reference'])
    })
})
