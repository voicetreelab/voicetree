import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'vitest'
import { mountWatcher, type Watcher } from './daemonWatcher.ts'

/**
 * Regression test for the vt-mcpd "hangs against empty temp project" bug.
 *
 * Before the fix, the chokidar `ignored` predicate branched on
 * `path.extname()` when chokidar invoked it without stats. `path.extname()`
 * returns a non-empty string for any directory whose basename contains a
 * dot (`My Project.notes`, `mktemp -d /tmp/project.XXXX`, …) — so the watch
 * root itself was reported as "ignored" by the predicate.
 *
 * chokidar's macOS FsEventsHandler checks `_isIgnored(watchPath)` BEFORE
 * setting up the fsevents listener (`lib/fsevents-handler.js` line 305).
 * When that returned `true`, the fsevents subscription was silently
 * skipped — the second `_emitReady()` was never called, so `_readyCount`
 * was never satisfied, and `watcher.ready` never resolved. Anything
 * awaiting ready (`startDaemonWatcher` inside `openProjectWorkflow`,
 * inside `startDaemon`, inside `bin/vt-mcpd.ts`) hung forever.
 *
 * These tests drive the real chokidar+fsevents pipeline with NODE_ENV unset
 * so polling is disabled (matching production vt-mcpd). If the predicate
 * regresses, `watcher.ready` hangs and the per-test deadline fails.
 */
describe('mountWatcher: ready resolves with the real chokidar+fsevents backend', () => {
  const created: string[] = []
  const originalNodeEnv: string | undefined = process.env.NODE_ENV
  const originalHeadlessTest: string | undefined = process.env.HEADLESS_TEST

  beforeEach(() => {
    delete process.env.HEADLESS_TEST
    delete process.env.NODE_ENV
  })

  afterEach(async () => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalHeadlessTest === undefined) delete process.env.HEADLESS_TEST
    else process.env.HEADLESS_TEST = originalHeadlessTest
    for (const dir of created.splice(0)) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('empty project with a dotted basename', async () => {
    const parent: string = await mkdtemp(join(tmpdir(), 'vt-daemonwatcher-'))
    created.push(parent)
    const dottedProject: string = join(parent, 'vt-project.empty')
    await mkdir(dottedProject, { recursive: true })

    const watcher: Watcher = mountWatcher([dottedProject], dottedProject)
    try {
      await withTimeout(watcher.ready, 4000, 'watcher.ready did not resolve for dotted empty project')
    } finally {
      await watcher.unmount()
    }
  }, 10000)

  test('populated project with a dotted basename', async () => {
    const parent: string = await mkdtemp(join(tmpdir(), 'vt-daemonwatcher-'))
    created.push(parent)
    const dottedProject: string = join(parent, 'vt-project.populated')
    await mkdir(dottedProject, { recursive: true })
    await writeFile(join(dottedProject, 'starter.md'), '# starter\n')

    const watcher: Watcher = mountWatcher([dottedProject], dottedProject)
    try {
      await withTimeout(watcher.ready, 4000, 'watcher.ready did not resolve for dotted populated project')
    } finally {
      await watcher.unmount()
    }
  }, 10000)

  test('project with a clean (dotless) basename', async () => {
    // Sanity control: confirms the test harness can detect a healthy chokidar path.
    const parent: string = await mkdtemp(join(tmpdir(), 'vt-daemonwatcher-'))
    created.push(parent)
    const cleanProject: string = join(parent, 'clean-project')
    await mkdir(cleanProject, { recursive: true })

    const watcher: Watcher = mountWatcher([cleanProject], cleanProject)
    try {
      await withTimeout(watcher.ready, 4000, 'watcher.ready did not resolve for clean project')
    } finally {
      await watcher.unmount()
    }
  }, 10000)
})

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout: Promise<never> = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message} within ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
