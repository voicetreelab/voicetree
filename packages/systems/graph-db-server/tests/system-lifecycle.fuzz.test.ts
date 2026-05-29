import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'vitest'

import { saveVaultConfigForDirectory } from '@vt/app-config/vault-config'
import { startDaemon, type DaemonHandle } from '../src/daemon/index.ts'
import { generateAction } from './system-lifecycle-fuzz/actions.ts'
import { cleanupSequence } from './system-lifecycle-fuzz/drain.ts'
import { fetchDaemonGraph } from './system-lifecycle-fuzz/daemon-http.ts'
import { assertInvariants } from './system-lifecycle-fuzz/invariants.ts'
import { waitFor } from './system-lifecycle-fuzz/poll.ts'
import { mulberry32, randInt } from './system-lifecycle-fuzz/prng.ts'
import { emptyTrackedState, resetForNextSequence } from './system-lifecycle-fuzz/types.ts'

describe('system lifecycle fuzz (100 sequences, black-box HTTP)', () => {
  let root: string
  let vault: string
  let handle: DaemonHandle | null

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-fuzz-system-'))
    vault = path.join(root, 'vault')
    process.env.VOICETREE_HOME_PATH = path.join(root, 'app-support')
    await mkdir(vault, { recursive: true })
    await saveVaultConfigForDirectory(vault, { writeFolderPath: '.' })
    handle = null
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })

  it('maintains invariants across 100 random command sequences', { timeout: 180_000 }, async () => {
    handle = await startDaemon({
      vault,
      voicetreeHomePath: path.join(root, 'app-support'),
      createStarterIfEmpty: false,
    })
    const baseUrl = `http://127.0.0.1:${handle.port}`

    const SEED = 0xF077_CAFE
    const SEQUENCES = 100
    const topRng = mulberry32(SEED)

    // tracked.deletedNodeIds accumulates across sequences so I3's
    // `targetWasDeleted` predicate keeps holding for any leaked-then-referenced
    // node — what used to be a cross-sequence I3 false-positive becomes a
    // silent correct pass.
    const tracked = emptyTrackedState()

    for (let seq = 0; seq < SEQUENCES; seq++) {
      const seqSeed = (topRng() * 0xFFFFFFFF) >>> 0
      const seqRng = mulberry32(seqSeed)
      const seqLen = randInt(seqRng, 8, 20)

      for (let step = 0; step < seqLen; step++) {
        const action = generateAction(seqRng, vault, baseUrl, tracked, seq, step)
        const ctx = `seq=${seq} seed=0x${seqSeed.toString(16)} step=${step} action=${action.type}`

        await action.execute()

        // createFile is best-effort: the watcher may need more time on slow CI.
        // Per-step invariants tolerate a missing file node.
        if (action.type === 'createFile') {
          const createdFiles = [...tracked.filesOnDisk.keys()]
          const lastFile = createdFiles[createdFiles.length - 1]
          if (lastFile) {
            await waitFor(async () => {
              const graph = await fetchDaemonGraph(baseUrl)
              return !!graph.nodes[lastFile]
            }).catch(() => {})
          }
        }

        // Give the watcher a moment to drop the deleted file's node.
        if (action.type === 'deleteFile') {
          await new Promise((resolve) => setTimeout(resolve, 300))
        }

        if (step % 3 === 0 || step === seqLen - 1) {
          await assertInvariants(baseUrl, tracked, ctx)
        }
      }

      const ctx = `seq=${seq} seed=0x${seqSeed.toString(16)} final`
      await assertInvariants(baseUrl, tracked, ctx)
      await cleanupSequence(baseUrl, tracked)
      resetForNextSequence(tracked)
    }
  })
})
