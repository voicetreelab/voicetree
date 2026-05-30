import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionInfoSchema } from '@vt/graph-db-server/contract'
import {
  closeFolderVisibilityForProject,
  getCurrentFolderVisibilityDb,
  openFolderVisibilityForProject,
  updateCurrentFolderState,
} from '../../../data/views/folderVisibilityResource.ts'
import {
  clearWatchFolderState,
  setProjectRoot,
} from '../../../state/watch-folder-store.ts'
import { createView, switchActiveView } from '../../../data/views/viewsRepository.ts'
import { SessionRegistry } from '../../session/registry.ts'
import { readSessionWorkflow } from '../sessionRoutes.ts'

// Black-box: drive the WRITER (resource-layer updateCurrentFolderState) and the
// READER (readSessionWorkflow → readFolderStateSize) and assert the reader
// observes what the writer wrote. The regression: the reader used to resolve the
// active view through an independent fresh db handle, which could diverge from
// the writer's handle and report 0 rows for a session that actually had rows.
describe('readSessionWorkflow folderStateSize reads the writer handle', () => {
  let project: string

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'graphd-fss-test-'))
    setProjectRoot(project as never)
    await openFolderVisibilityForProject(project)
  })

  afterEach(async () => {
    await closeFolderVisibilityForProject().catch(() => {})
    clearWatchFolderState()
    await rm(project, { recursive: true, force: true })
  })

  function showFolderStateSize(registry: SessionRegistry, sessionId: string): number {
    const result = readSessionWorkflow(registry, sessionId)
    if (result.kind !== 'json') {
      throw new Error(`expected json result, got ${result.kind}`)
    }
    return SessionInfoSchema.parse(result.body).folderStateSize
  }

  test('reports zero rows for a freshly opened (empty) active view', () => {
    const registry = new SessionRegistry()
    const session = registry.create()
    expect(showFolderStateSize(registry, session.id)).toBe(0)
  })

  test('reflects rows written through the resource-layer writer', () => {
    const registry = new SessionRegistry()
    const session = registry.create()

    updateCurrentFolderState(join(project, 'docs'), 'collapsed')
    updateCurrentFolderState(join(project, 'src'), 'expanded')
    updateCurrentFolderState(join(project, 'tmp'), 'collapsed')

    expect(showFolderStateSize(registry, session.id)).toBe(3)
  })

  test('treats overwriting the same path as an update, not a new row', () => {
    const registry = new SessionRegistry()
    const session = registry.create()
    const docs = join(project, 'docs')

    updateCurrentFolderState(docs, 'collapsed')
    updateCurrentFolderState(docs, 'expanded')

    expect(showFolderStateSize(registry, session.id)).toBe(1)
  })

  test('follows the active view the writer switched to (no per-view drift)', () => {
    const registry = new SessionRegistry()
    const session = registry.create()

    // Default view gets one row; a switched-to second view gets two. The reader
    // must report the rows of whichever view the writer's handle has active.
    updateCurrentFolderState(join(project, 'default-only'), 'collapsed')

    const db = getCurrentFolderVisibilityDb()
    const { viewId } = createView(db, 'secondary')
    switchActiveView(db, viewId)

    updateCurrentFolderState(join(project, 'docs'), 'expanded')
    updateCurrentFolderState(join(project, 'src'), 'collapsed')

    // Active view is now the secondary view (2 rows), not the default (1 row).
    expect(showFolderStateSize(registry, session.id)).toBe(2)
  })

  test('returns notFound for an unknown session id', () => {
    const registry = new SessionRegistry()
    const result = readSessionWorkflow(registry, '00000000-0000-4000-8000-000000000000')
    expect(result.kind).toBe('notFound')
  })
})
