import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'vitest'

import { startDaemon, type DaemonHandle } from '../src/daemon/index.ts'
import { runLifecycleFuzz } from './system-lifecycle.fuzz/scenario.ts'

describe('system lifecycle fuzz (100 sequences, black-box HTTP)', () => {
  let root: string
  let vault: string
  let handle: DaemonHandle | null

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-fuzz-system-'))
    vault = path.join(root, 'vault')
    await mkdir(vault, { recursive: true })
    handle = null
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })

  it('maintains invariants across 100 random command sequences', { timeout: 180_000 }, async () => {
    handle = await startDaemon({
      vault,
      appSupportPath: path.join(root, 'app-support'),
    })

    await runLifecycleFuzz({
      baseUrl: `http://127.0.0.1:${handle.port}`,
      vault,
      seed: 0xF077_CAFE,
      sequenceCount: 100,
    })
  })
})
