import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import normalizePath from 'normalize-path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { FSDelete, FSUpdate, GraphNode } from '@vt/graph-model'
import { mountWatcher, type Watcher, type MountWatcherDependencies } from './daemonWatcher.ts'

/**
 * Regression test for the vtd "hangs against empty temp project" bug.
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
 * inside `startDaemon`, inside `bin/vtd.ts`) hung forever.
 *
 * These tests drive the real chokidar+fsevents pipeline with NODE_ENV unset
 * so polling is disabled (matching production vtd). If the predicate
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

/**
 * Regression test for REC 4: `.voicetree/` daemon-internal markdown must not
 * surface as a spurious graph node. Drives the real chokidar pipeline against a
 * temp project containing both a normal `.md` file and a `.voicetree/prompts/*.md`
 * file, and asserts on the OBSERVABLE side effect — the FS events that flow to
 * the graph-state handler. The `.voicetree` file must never produce an event;
 * the normal file must.
 */
describe('mountWatcher: excludes .voicetree/ files from the graph', () => {
  const created: string[] = []
  const originalHeadlessTest: string | undefined = process.env.HEADLESS_TEST

  beforeEach(() => {
    // Force polling so the watch-time 'add' is reliably observed in CI/macOS.
    process.env.HEADLESS_TEST = '1'
  })

  afterEach(async () => {
    if (originalHeadlessTest === undefined) delete process.env.HEADLESS_TEST
    else process.env.HEADLESS_TEST = originalHeadlessTest
    for (const dir of created.splice(0)) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a .voicetree/prompts/*.md add yields no graph node; a normal .md add does', async () => {
    const parent: string = await mkdtemp(join(tmpdir(), 'vt-voicetree-scope-'))
    created.push(parent)
    const project: string = join(parent, 'project')
    await mkdir(join(project, '.voicetree', 'prompts'), { recursive: true })
    await mkdir(join(project, 'notes'), { recursive: true })

    const addedPaths: string[] = []
    const deps: MountWatcherDependencies = {
      readFileWithRetry: async () => '# content\n',
      handleFSEvent: (event: FSUpdate | FSDelete) => {
        if ('eventType' in event && event.eventType === 'Added') {
          addedPaths.push(event.absolutePath)
        }
      },
      logger: { error: () => undefined },
      // In production the cold scan loads `notes/` before the watcher mounts, so
      // a loose file appearing there ingests. Seed one loaded node under it so
      // the "new folders unloaded by default" gate sees `notes/` as loaded —
      // this test exercises the `.voicetree` IGNORE rule, not the load gate.
      getGraphNodes: () => ({ [`${normalizePath(join(project, 'notes'))}/seed.md`]: {} }),
      getGraphNode: () => undefined,
    }

    const watcher: Watcher = mountWatcher([project], project, deps)
    try {
      await withTimeout(watcher.ready, 4000, 'watcher.ready did not resolve')

      // Trigger watch-time 'add' events for both files.
      await writeFile(join(project, '.voicetree', 'prompts', 'leak.md'), '# leak\n')
      await writeFile(join(project, 'notes', 'keep.md'), '# keep\n')

      await expect
        .poll(() => addedPaths.some((p) => p.endsWith('/notes/keep.md')), { timeout: 4000 })
        .toBe(true)

      // The normal file produced a node; the .voicetree file produced none.
      expect(addedPaths.some((p) => p.includes('/.voicetree/'))).toBe(false)
    } finally {
      await watcher.unmount()
    }
  }, 12000)
})

/**
 * "New folders unloaded by default" (the worktree-flood fix). Drives the real
 * chokidar pipeline and asserts on the OBSERVABLE side effect — which 'add'
 * events reach the graph handler. A brand-new folder dropped under a loaded
 * project (e.g. a `git worktree add` checkout) must NOT ingest its markdown;
 * loose new files in already-loaded folders must still ingest instantly.
 */
describe('mountWatcher: new folders are unloaded by default (no flood)', () => {
  const created: string[] = []
  const originalHeadlessTest: string | undefined = process.env.HEADLESS_TEST

  beforeEach(() => {
    // Force polling so watch-time 'add' events are reliably observed in CI/macOS.
    process.env.HEADLESS_TEST = '1'
  })

  afterEach(async () => {
    if (originalHeadlessTest === undefined) delete process.env.HEADLESS_TEST
    else process.env.HEADLESS_TEST = originalHeadlessTest
    for (const dir of created.splice(0)) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a brand-new folder of many .md does not ingest; loose files in loaded folders do', async () => {
    const parent: string = await mkdtemp(join(tmpdir(), 'vt-unload-new-folders-'))
    created.push(parent)
    const project: string = join(parent, 'project')
    await mkdir(join(project, 'loaded'), { recursive: true })
    await writeFile(join(project, 'README.md'), '# existing readme\n')

    // The loaded project as the daemon sees it after the cold scan: the root is
    // a watch root, and `loaded/` already holds a node.
    const graphNodes: Record<string, unknown> = {
      [`${normalizePath(join(project, 'loaded'))}/existing.md`]: {},
      [normalizePath(join(project, 'README.md'))]: {},
    }

    const addedPaths: string[] = []
    const deps: MountWatcherDependencies = {
      readFileWithRetry: async () => '# content\n',
      handleFSEvent: (event: FSUpdate | FSDelete) => {
        if ('eventType' in event && event.eventType === 'Added') {
          addedPaths.push(normalizePath(event.absolutePath))
        }
      },
      logger: { error: () => undefined },
      getGraphNodes: () => graphNodes,
      getGraphNode: () => undefined,
    }

    const watcher: Watcher = mountWatcher([project], project, deps)
    try {
      await withTimeout(watcher.ready, 4000, 'watcher.ready did not resolve')

      // A brand-new nested folder tree appears (simulating a worktree checkout).
      // Written FIRST so its 'add' events are surfaced no later than the loose
      // files below — making the absence assertion deterministic under polling.
      await mkdir(join(project, 'wt-feature', 'packages', 'app'), { recursive: true })
      await writeFile(join(project, 'wt-feature', 'README.md'), '# readme\n')
      await writeFile(join(project, 'wt-feature', 'architecture.md'), '# arch\n')
      await writeFile(join(project, 'wt-feature', 'packages', 'app', 'index.md'), '# idx\n')

      // Loose new files that MUST still load: one in an already-loaded subfolder,
      // one directly at the (watch-root) project root.
      await writeFile(join(project, 'loaded', 'fresh.md'), '# fresh\n')
      await writeFile(join(project, 'root-note.md'), '# root\n')

      // Both loose files ingest...
      await expect
        .poll(
          () =>
            addedPaths.some((p) => p.endsWith('/loaded/fresh.md')) &&
            addedPaths.some((p) => p.endsWith('/root-note.md')),
          { timeout: 5000 },
        )
        .toBe(true)

      // ...and not a single file from the brand-new folder did.
      expect(addedPaths.some((p) => p.includes('/wt-feature/'))).toBe(false)
    } finally {
      await watcher.unmount()
    }
  }, 15000)

})

/**
 * Move-aware ingestion gate (the regression from "unload new folders by
 * default"). Moving a loaded note into a brand-new (unloaded) subfolder is an
 * unlink + add; the add would otherwise be gated out, dropping the moved node.
 * These drive the real chokidar pipeline and assert on the OBSERVABLE events
 * reaching the graph handler. Edge healing itself is covered by the e2e and the
 * pure heal tests; here we only assert WHICH Added/Delete events fire.
 */
describe('mountWatcher: a loaded note moved into an unloaded folder re-ingests', () => {
  const created: string[] = []
  const originalHeadlessTest: string | undefined = process.env.HEADLESS_TEST

  beforeEach(() => {
    // Force polling so watch-time events are reliably observed in CI/macOS.
    process.env.HEADLESS_TEST = '1'
  })

  afterEach(async () => {
    if (originalHeadlessTest === undefined) delete process.env.HEADLESS_TEST
    else process.env.HEADLESS_TEST = originalHeadlessTest
    for (const dir of created.splice(0)) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // Captures observable events and seeds the loaded graph for the gate + identity.
  const makeDeps = (
    project: string,
    loadedNodes: Record<string, GraphNode>,
  ): {
    deps: MountWatcherDependencies
    addedPaths: string[]
    deletedPaths: string[]
  } => {
    const addedPaths: string[] = []
    const deletedPaths: string[] = []
    const deps: MountWatcherDependencies = {
      readFileWithRetry: (p: string) => readFile(p, 'utf8'),
      handleFSEvent: (event: FSUpdate | FSDelete) => {
        if ('eventType' in event && event.eventType === 'Added') {
          addedPaths.push(normalizePath(event.absolutePath))
        } else if ('type' in event && event.type === 'Delete') {
          deletedPaths.push(normalizePath(event.absolutePath))
        }
      },
      logger: { error: () => undefined },
      // Keys-only view for the gate; non-empty so the project root reads as loaded.
      getGraphNodes: () => loadedNodes,
      getGraphNode: (nodeId: string) => loadedNodes[nodeId],
      moveWindowMs: 8000,
    }
    return { deps, addedPaths, deletedPaths }
  }

  const leafNode = (contentWithoutYamlOrLinks: string): GraphNode =>
    ({ kind: 'leaf', contentWithoutYamlOrLinks } as GraphNode)

  test('same-basename move into a new subfolder ingests the moved node', async () => {
    const parent: string = await mkdtemp(join(tmpdir(), 'vt-move-ingest-'))
    created.push(parent)
    const project: string = join(parent, 'project')
    await mkdir(project, { recursive: true })

    const content = '# Moved Note\nbody text\n'
    const targetPath: string = join(project, 'target.md')
    const targetId: string = normalizePath(targetPath)
    // target.md exists and is loaded before mount; its initial presence is ignored.
    await writeFile(targetPath, content)

    const { deps, addedPaths, deletedPaths } = makeDeps(project, { [targetId]: leafNode(content) })

    const watcher: Watcher = mountWatcher([project], project, deps)
    try {
      await withTimeout(watcher.ready, 4000, 'watcher.ready did not resolve')

      // Move target.md into a brand-new (unloaded) subfolder.
      await mkdir(join(project, 'archive'), { recursive: true })
      await rename(targetPath, join(project, 'archive', 'target.md'))

      // The moved node re-enters the graph (Added for the new path)…
      await expect
        .poll(() => addedPaths.some((p) => p.endsWith('/archive/target.md')), { timeout: 6000 })
        .toBe(true)
      // …and the old path was deleted.
      expect(deletedPaths.some((p) => p.endsWith('/target.md') && !p.includes('/archive/'))).toBe(true)
    } finally {
      await watcher.unmount()
    }
  }, 20000)

  test('same basename but different content is NOT treated as a move (stays unloaded)', async () => {
    const parent: string = await mkdtemp(join(tmpdir(), 'vt-move-diff-'))
    created.push(parent)
    const project: string = join(parent, 'project')
    await mkdir(project, { recursive: true })

    const targetPath: string = join(project, 'target.md')
    const targetId: string = normalizePath(targetPath)
    await writeFile(targetPath, '# Original content\n')

    // The loaded node's identity is the ORIGINAL content.
    const { deps, addedPaths, deletedPaths } = makeDeps(project, {
      [targetId]: leafNode('# Original content\n'),
    })

    const watcher: Watcher = mountWatcher([project], project, deps)
    try {
      await withTimeout(watcher.ready, 4000, 'watcher.ready did not resolve')

      // Old file disappears; a DIFFERENT-content file with the same basename
      // appears in a new unloaded folder. Not the same node → must not ingest.
      await mkdir(join(project, 'archive'), { recursive: true })
      await rm(targetPath)
      await writeFile(join(project, 'archive', 'target.md'), '# Totally different\n')

      // The delete is observed…
      await expect
        .poll(() => deletedPaths.some((p) => p.endsWith('/target.md') && !p.includes('/archive/')), {
          timeout: 6000,
        })
        .toBe(true)
      // …give the (rejected) move-probe time to run, then assert no Added landed.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(addedPaths.some((p) => p.includes('/archive/'))).toBe(false)
    } finally {
      await watcher.unmount()
    }
  }, 20000)

  test('an unlinked loaded node with no following add finalizes as a plain delete', async () => {
    const parent: string = await mkdtemp(join(tmpdir(), 'vt-move-deleteonly-'))
    created.push(parent)
    const project: string = join(parent, 'project')
    await mkdir(project, { recursive: true })

    const targetPath: string = join(project, 'target.md')
    const targetId: string = normalizePath(targetPath)
    await writeFile(targetPath, '# Just deleted\n')

    const { deps, addedPaths, deletedPaths } = makeDeps(project, {
      [targetId]: leafNode('# Just deleted\n'),
    })

    const watcher: Watcher = mountWatcher([project], project, deps)
    try {
      await withTimeout(watcher.ready, 4000, 'watcher.ready did not resolve')

      await rm(targetPath)

      await expect
        .poll(() => deletedPaths.some((p) => p.endsWith('/target.md')), { timeout: 6000 })
        .toBe(true)
      // Nothing was ever added; the buffered unlink just expires.
      expect(addedPaths).toEqual([])
    } finally {
      await watcher.unmount()
    }
  }, 20000)
})
