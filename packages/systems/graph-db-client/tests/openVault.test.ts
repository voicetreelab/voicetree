import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createEmptyGraph } from '@vt/graph-model'
import { type DaemonHandle, startDaemon } from '@vt/graph-db-server/server'
import { setGraph } from '@vt/graph-db-server/state/graph-store'
import { clearWatchFolderState } from '@vt/graph-db-server/state/watch-folder-store'
import { GraphDbClient } from '../src/GraphDbClient.ts'
import { VaultNotOpenError, VaultOpenFailedError } from '../src/errors.ts'

describe('GraphDbClient vault lifecycle API', () => {
  let root: string
  let vault: string
  let handle: DaemonHandle | null

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'graph-db-client-open-vault-'))
    vault = join(root, 'vault')
    await mkdir(vault, { recursive: true })
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    handle = await startDaemon({
      vault,
      voicetreeHomePath: join(root, 'app-support'),
      createStarterIfEmpty: false,
    })
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    handle = null
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await rm(root, { recursive: true, force: true })
  })

  test('opens and closes a vault with typed response and typed 409 error', async () => {
    const client = new GraphDbClient({ baseUrl: `http://127.0.0.1:${handle!.port}` })
    await writeFile(join(vault, 'existing.md'), '# Existing\n', 'utf8')

    const opened = await client.openVault(vault, { writeFolder: vault })

    expect(opened.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    // setWriteFolder seeds the writeFolder as 'expanded' so the sidebar can show
    // its contents on mount. Children remain collapsed by default.
    expect(opened.vaultState).toMatchObject({
      projectRoot: vault,
      writeFolder: vault,
    })
    expect(opened.vaultState.readPaths).toContain(vault)
    expect(opened.folderState).toContainEqual([vault, 'expanded'])
    expect(opened.activeView).toMatchObject({ name: 'main' })
    expect(opened.activeView.viewId).toEqual(expect.any(String))

    await client.closeVault()

    await expect(client.getVault()).rejects.toBeInstanceOf(VaultNotOpenError)
  })

  test('maps vault_open_failed 409 responses to VaultOpenFailedError', async () => {
    const client = new GraphDbClient({ baseUrl: `http://127.0.0.1:${handle!.port}` })
    const filePath = join(root, 'not-a-directory')
    await writeFile(filePath, 'not a vault', 'utf8')

    await expect(client.openVault(filePath)).rejects.toBeInstanceOf(VaultOpenFailedError)
  })
})
