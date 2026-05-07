import type { Hono } from 'hono'
import {
  ViewResponseSchema,
  ExpandOverridesResponseSchema,
} from '../contract.ts'
import { SessionRegistry } from '../session/registry.ts'
import { getGraph } from '../state/graph-store.ts'
import { getProjectRootWatchedDirectory } from '../state/watch-folder-store.ts'
import { renderTreeCover, buildAutoViewGraphFromState } from '@vt/graph-tools/autoView'

export function mountViewRoutes(
  app: Hono,
  registry: SessionRegistry,
): void {
  app.get('/sessions/:sessionId/view', (c) => {
    const sessionId = c.req.param('sessionId')
    const session = registry.getOrCreate(sessionId)

    const rootPath = getProjectRootWatchedDirectory()
    if (!rootPath) {
      return c.json({ error: 'no vault loaded' }, 503)
    }

    const budgetParam = c.req.query('budget')
    const budget = budgetParam ? Math.max(1, Math.trunc(Number(budgetParam))) : 30

    const expandParams = c.req.queries('expand') ?? []
    const mergedExpands = [...session.expandOverrides, ...expandParams]

    const graph = buildAutoViewGraphFromState(getGraph(), rootPath)

    const output = renderTreeCover(graph, {
      collapsed: session.collapseSet,
      selected: session.selection,
      pinnedFolderIds: mergedExpands,
      budget,
    })

    return c.json(ViewResponseSchema.parse({ output, format: 'tree-cover' }))
  })

  app.post('/sessions/:sessionId/expand/:folderId', (c) => {
    const sessionId = c.req.param('sessionId')
    const session = registry.get(sessionId)
    if (!session) {
      return c.notFound()
    }

    const folderId = c.req.param('folderId')
    session.expandOverrides.add(folderId)
    registry.touch(sessionId)

    return c.json(ExpandOverridesResponseSchema.parse({
      expandOverrides: [...session.expandOverrides],
    }))
  })

  app.delete('/sessions/:sessionId/expand/:folderId', (c) => {
    const sessionId = c.req.param('sessionId')
    const session = registry.get(sessionId)
    if (!session) {
      return c.notFound()
    }

    const folderId = c.req.param('folderId')
    session.expandOverrides.delete(folderId)
    registry.touch(sessionId)

    return c.json(ExpandOverridesResponseSchema.parse({
      expandOverrides: [...session.expandOverrides],
    }))
  })
}
