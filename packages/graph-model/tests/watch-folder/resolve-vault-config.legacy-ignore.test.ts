import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { initGraphModel } from '../../src/types'
import { resolveAllowlistForProject } from '../../src/watch-folder/resolve-vault-config'
import { saveVaultConfigForDirectory } from '../../src/watch-folder/voicetree-config-io'
import {
    closeFolderVisibilityDb,
    openFolderVisibilityDb,
    type FolderVisibilityDatabase,
} from '../../src/sqlite/folderVisibilitySqlite'

describe('resolveAllowlistForProject legacy config compatibility', () => {
    let root: string
    let appSupportPath: string
    let projectRoot: string
    let legacyFolder: string
    let debugSpy: ReturnType<typeof vi.spyOn>

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-read-paths-'))
        appSupportPath = path.join(root, 'app-support')
        projectRoot = path.join(root, 'project')
        legacyFolder = path.join(projectRoot, 'legacy')
        await fs.mkdir(appSupportPath, { recursive: true })
        await fs.mkdir(legacyFolder, { recursive: true })
        initGraphModel({ appSupportPath })
        debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    })

    afterEach(async () => {
        debugSpy.mockRestore()
        await fs.rm(root, { recursive: true, force: true })
    })

    async function writeLegacyConfig(): Promise<void> {
        await fs.writeFile(
            path.join(appSupportPath, 'voicetree-config.json'),
            JSON.stringify({
                vaultConfig: {
                    [projectRoot]: {
                        writePath: projectRoot,
                        readPaths: [legacyFolder],
                    },
                },
            }),
            'utf8',
        )
    }

    it('ignores legacy readPaths without materializing folder_visibility rows', async () => {
        await writeLegacyConfig()

        const resolved = await resolveAllowlistForProject(projectRoot)

        expect(resolved).toEqual({
            allowlist: [projectRoot],
            writePath: projectRoot,
        })
        expect(debugSpy).toHaveBeenCalledWith(
            '[resolveAllowlistForProject] ignoring legacy readPaths from voicetree-config.json',
        )

        const db: FolderVisibilityDatabase = openFolderVisibilityDb(projectRoot)
        try {
            const count = db
                .prepare('SELECT COUNT(*) AS count FROM folder_visibility')
                .get() as { count: number }
            expect(count.count).toBe(0)
        } finally {
            closeFolderVisibilityDb(db)
        }
    })

    it('strips legacy readPaths on the next config write', async () => {
        await writeLegacyConfig()

        await saveVaultConfigForDirectory(projectRoot, { writePath: projectRoot })

        const saved = JSON.parse(
            fsSync.readFileSync(path.join(appSupportPath, 'voicetree-config.json'), 'utf8'),
        ) as { vaultConfig: Record<string, Record<string, unknown>> }
        expect(saved.vaultConfig[projectRoot]).toEqual({ writePath: projectRoot })
        expect(Object.hasOwn(saved.vaultConfig[projectRoot], 'readPaths')).toBe(false)
    })
})
