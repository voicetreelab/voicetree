import type { Hono } from 'hono'
import {
  ViewResponseSchema,
  ExpandOverridesResponseSchema,
} from '../contract.ts'
import { SessionRegistry } from '../session/registry.ts'
import { project } from '@vt/graph-state'
import { renderTreeCover } from '@vt/graph-tools/autoView'
import { buildDaemonState } from '../session/buildDaemonState.ts'

export function mountViewRoutes(
  app: Hono,
  registry: SessionRegistry,
): void {
  app.get('/sessions/:sessionId/view', async (c) => {
    const sessionId = c.req.param('sessionId')
    const session = registry.getOrCreate(sessionId)

    const budgetParam = c.req.query('budget')
    const budget = budgetParam ? Math.max(1, Math.trunc(Number(budgetParam))) : 30

    const expandParams = c.req.queries('expand') ?? []
    const mergedExpands = [...session.expandOverrides, ...expandParams]

    const state = await buildDaemonState(session)
    const graph = project(state)

    const output = renderTreeCover(graph, {
      collapsed: session.collapseSet,
      selected: session.selection,
      pinnedFolderIds: mergedExpands,
      budget,
    })

    return c.json(ViewResponseSchema.parse({ output, format: 'tree-cover' }))
  })

  app.get('/sessions/:sessionId/projected-graph', async (c) => {
    const sessionId = c.req.param('sessionId')
    const session = registry.getOrCreate(sessionId)

    const state = await buildDaemonState(session)
    const graph = project(state)

    return c.json(graph, 200, {
      'Content-Type': 'application/json',
    })
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
