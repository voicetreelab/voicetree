import { describe, expect, test } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { project } from '@vt/graph-state'
import { applyGraphDeltaToGraph, type Graph, type GraphDelta, type GraphNode } from '@vt/graph-model/graph'
import { toAbsolutePath, type FolderTreeNode } from '@vt/graph-model'
import type { ProjectState } from '@vt/graph-db-server/contract'
import { handleProjectDeltaEvent, type ProjectDeltaEventInput } from '../core/handleSessionEvents.ts'
import { projectGraphDerivedFolderTree } from '../projection/graphDerivedFolderTree.ts'
import { projectSessionState } from './project.ts'
import { makeProjectSessionStateFixtures } from './project/__tests__/fixtures.ts'
import { sessionProjectionCache } from './sessionProjectionCache.ts'
import type { Session } from './types.ts'

type DaemonStateSnapshot = Parameters<typeof sessionProjectionCache.create>[0]

function makeNode(id: string, content: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
    },
  }
}

function folderTreeFor(graph: Graph, project: ProjectState, projectPaths: readonly string[]): FolderTreeNode | null {
  return projectGraphDerivedFolderTree({
    graph,
    projectRoot: project.projectRoot ? toAbsolutePath(project.projectRoot) : null,
    readPaths: project.readPaths,
    projectPaths,
    writeFolderPath: project.writeFolderPath ? toAbsolutePath(project.writeFolderPath) : null,
  })
}

function snapshotFor(input: {
  readonly graph: Graph
  readonly projectVersion?: number
  readonly session: Session
  readonly project: ProjectState
  readonly projectPaths: readonly string[]
  readonly projectPathsVersion?: number
}): DaemonStateSnapshot {
  return {
    folderTree: folderTreeFor(input.graph, input.project, input.projectPaths),
    graph: input.graph,
    projectRoot: input.project.projectRoot,
    projectVersion: input.projectVersion ?? 1,
    readPaths: input.project.readPaths,
    session: input.session,
    project: input.project,
    projectPaths: input.projectPaths,
    projectPathsVersion: input.projectPathsVersion ?? 1,
    writeFolderPath: input.project.writeFolderPath,
  }
}

function makeDeltaSequence(initialGraph: Graph): readonly GraphDelta[] {
  const targetId = '/project/public/target.md'
  const targetNode = initialGraph.nodes[targetId]
  if (!targetNode) throw new Error('fixture target missing')
  const movedNode = makeNode('/project/public/moved-target.md', 'Moved target')

  return [
    [{
      type: 'UpsertNode',
      nodeToUpsert: makeNode('/project/public/new-1.md', 'New 1'),
      previousNode: O.none,
    }],
    [{
      type: 'UpsertNode',
      nodeToUpsert: {
        ...targetNode,
        contentWithoutYamlOrLinks: 'Target updated',
      },
      previousNode: O.some(targetNode),
    }],
    [
      {
        type: 'DeleteNode',
        nodeId: targetId,
        deletedNode: O.some(targetNode),
      },
      {
        type: 'UpsertNode',
        nodeToUpsert: movedNode,
        previousNode: O.none,
      },
    ],
    [{
      type: 'DeleteNode',
      nodeId: '/project/secret/new-link.md',
      deletedNode: O.fromNullable(initialGraph.nodes['/project/secret/new-link.md']),
    }],
  ]
}

type FuzzModel = {
  cache: ReturnType<typeof sessionProjectionCache.create>
  graph: Graph
  projectVersion: number
  session: Session
  project: ProjectState
  projectPaths: readonly string[]
  projectPathsVersion: number
}

type Rng = { seed: number }

function nextInt(rng: Rng, maxExclusive: number): number {
  rng.seed = (rng.seed * 1_664_525 + 1_013_904_223) >>> 0
  return rng.seed % maxExclusive
}

function rebuildCache(model: FuzzModel): FuzzModel {
  return {
    ...model,
    cache: sessionProjectionCache.create(snapshotFor({
      graph: model.graph,
      projectVersion: model.projectVersion,
      session: model.session,
      project: model.project,
      projectPaths: model.projectPaths,
      projectPathsVersion: model.projectPathsVersion,
    })),
  }
}

function rebuiltStateFor(model: FuzzModel) {
  const snapshot = snapshotFor({
    graph: model.graph,
    projectVersion: model.projectVersion,
    session: model.session,
    project: model.project,
    projectPaths: model.projectPaths,
    projectPathsVersion: model.projectPathsVersion,
  })
  return projectSessionState({
    graph: snapshot.graph,
    project: snapshot.project,
    folderTree: snapshot.folderTree,
    session: snapshot.session,
  })
}

function expectCachedProjectionToMatchRebuild(
  model: FuzzModel,
  event: ProjectDeltaEventInput,
): void {
  const cachedState = sessionProjectionCache.project(model.cache)
  const rebuiltState = rebuiltStateFor(model)

  expect(handleProjectDeltaEvent(cachedState, event).graph).toEqual(
    handleProjectDeltaEvent(rebuiltState, event).graph,
  )
  expect(cachedState.roots.folderTree).toEqual(rebuiltState.roots.folderTree)
  expect(cachedState.collapseSet).toEqual(rebuiltState.collapseSet)
}

function expectCachedStateToMatchRebuild(model: FuzzModel): void {
  const cachedState = sessionProjectionCache.project(model.cache)
  const rebuiltState = rebuiltStateFor(model)

  expect(project(cachedState)).toEqual(project(rebuiltState))
  expect(cachedState.roots.folderTree).toEqual(rebuiltState.roots.folderTree)
  expect(cachedState.collapseSet).toEqual(rebuiltState.collapseSet)
}

function observedProjectedGraph(cache: ReturnType<typeof sessionProjectionCache.create>, event: ProjectDeltaEventInput): string {
  return JSON.stringify(handleProjectDeltaEvent(sessionProjectionCache.project(cache), event).graph)
}

function makeFuzzDelta(model: FuzzModel, rng: Rng, step: number): GraphDelta {
  const nodeIds = Object.keys(model.graph.nodes)
  const choice = nextInt(rng, 3)

  if (choice === 0 || nodeIds.length === 0) {
    const node = makeNode(`/project/public/fuzz-${step}.md`, `Fuzz ${step}`)
    return [{
      type: 'UpsertNode',
      nodeToUpsert: node,
      previousNode: O.fromNullable(model.graph.nodes[node.absoluteFilePathIsID]),
    }]
  }

  const nodeId = nodeIds[nextInt(rng, nodeIds.length)]!
  const node = model.graph.nodes[nodeId]!
  if (choice === 1) {
    return [{
      type: 'UpsertNode',
      nodeToUpsert: {
        ...node,
        contentWithoutYamlOrLinks: `${node.contentWithoutYamlOrLinks} updated ${step}`,
      },
      previousNode: O.some(node),
    }]
  }

  const movedNode = makeNode(`/project/workspace/fuzz-moved-${step}.md`, `Moved ${step}`)
  return [
    {
      type: 'DeleteNode',
      nodeId,
      deletedNode: O.some(node),
    },
    {
      type: 'UpsertNode',
      nodeToUpsert: movedNode,
      previousNode: O.none,
    },
  ]
}

function mutateFolderState(model: FuzzModel, rng: Rng): FuzzModel {
  const paths = ['/project/public', '/project/secret', '/project/workspace']
  const states = ['expanded', 'collapsed', 'hidden'] as const
  const path = paths[nextInt(rng, paths.length)]!
  const current = model.session.folderState.get(path)
  const nextState = states.find(state => state !== current)!
  model.session.folderState.set(path, nextState)
  expect(sessionProjectionCache.shouldRebuild({
    cache: model.cache,
    session: model.session,
    projectPathsVersion: model.projectPathsVersion,
  })).toBe(true)
  return rebuildCache(model)
}

function mutateProjectPaths(model: FuzzModel, rng: Rng): FuzzModel {
  const readPathSets = [
    ['/project/docs'],
    ['/project/docs', '/project/public'],
    ['/project/secret'],
  ] as const
  const writeFolderPaths = ['/project', '/project/workspace'] as const
  const roots = ['/project', '/project-alt'] as const

  const projectRoot = roots[nextInt(rng, roots.length)]!
  const writeFolderPath = writeFolderPaths[nextInt(rng, writeFolderPaths.length)]!
  const readPaths = [...readPathSets[nextInt(rng, readPathSets.length)]!]
  const project = { projectRoot, readPaths, writeFolderPath }
  const nextModel: FuzzModel = {
    ...model,
    projectPathsVersion: model.projectPathsVersion + 1,
    project,
    projectPaths: [project.writeFolderPath, ...project.readPaths],
  }

  expect(sessionProjectionCache.shouldRebuild({
    cache: nextModel.cache,
    session: nextModel.session,
    projectPathsVersion: nextModel.projectPathsVersion,
  })).toBe(true)
  return rebuildCache(nextModel)
}

function mutateSelectionAndLayout(model: FuzzModel, rng: Rng, step: number): FuzzModel {
  const nodeIds = Object.keys(model.graph.nodes)
  if (nodeIds.length > 0) {
    model.session.selection.add(nodeIds[nextInt(rng, nodeIds.length)]!)
  }
  model.session.layout.pan = { x: step * 3, y: step * 5 }
  model.session.layout.zoom = 1 + (nextInt(rng, 4) / 10)
  model.session.layout.positions[`layout-${step}`] = { x: step, y: step + 1 }

  expect(sessionProjectionCache.shouldRebuild({
    cache: model.cache,
    session: model.session,
    projectPathsVersion: model.projectPathsVersion,
  })).toBe(false)
  return model
}

describe('session projection cache', () => {
  test('matches rebuild-from-scratch across upsert, update, move, and delete deltas', () => {
    const fixtures = makeProjectSessionStateFixtures()
    const session = fixtures.makeSession({
      folderState: new Map([
        ['/project/public', 'expanded'],
        ['/project/secret', 'expanded'],
      ]),
    })
    const project = fixtures.makeProject()
    const projectPaths = [project.writeFolderPath, ...project.readPaths]
    let graph = fixtures.makeVisibilityGraph()
    let cache = sessionProjectionCache.create(snapshotFor({ graph, session, project, projectPaths }))

    for (const [index, delta] of makeDeltaSequence(graph).entries()) {
      const event: ProjectDeltaEventInput = { delta, seq: index + 1 }
      graph = applyGraphDeltaToGraph(graph, delta)

      const rebuiltSnapshot = snapshotFor({ graph, session, project, projectPaths })
      const rebuiltState = projectSessionState({
        graph: rebuiltSnapshot.graph,
        project: rebuiltSnapshot.project,
        folderTree: rebuiltSnapshot.folderTree,
        session: rebuiltSnapshot.session,
      })
      cache = sessionProjectionCache.advance(cache, event)
      const cachedState = sessionProjectionCache.project(cache)

      expect(handleProjectDeltaEvent(cachedState, event).graph).toEqual(
        handleProjectDeltaEvent(rebuiltState, event).graph,
      )
      expect(cachedState.roots.folderTree).toEqual(rebuiltState.roots.folderTree)
      expect(cachedState.collapseSet).toEqual(rebuiltState.collapseSet)
    }
  })

  test('survives graph deltas even when project version advances', () => {
    const fixtures = makeProjectSessionStateFixtures()
    const session = fixtures.makeSession({
      folderState: new Map([
        ['/project/public', 'expanded'],
        ['/project/secret', 'expanded'],
      ]),
    })
    const project = fixtures.makeProject()
    const projectPaths = [project.writeFolderPath, ...project.readPaths]
    let graph = fixtures.makeVisibilityGraph()
    let projectVersion = 10
    const projectPathsVersion = 4
    let cache = sessionProjectionCache.create(snapshotFor({
      graph,
      projectVersion,
      session,
      project,
      projectPaths,
      projectPathsVersion,
    }))

    for (const [index, delta] of makeDeltaSequence(graph).entries()) {
      projectVersion += 1
      expect(sessionProjectionCache.shouldRebuild({ cache, session, projectPathsVersion })).toBe(false)

      const event: ProjectDeltaEventInput = { delta, seq: index + 1 }
      graph = applyGraphDeltaToGraph(graph, delta)
      cache = sessionProjectionCache.advance(cache, event)

      const model: FuzzModel = { cache, graph, projectVersion, session, project, projectPaths, projectPathsVersion }
      expectCachedStateToMatchRebuild(model)
    }

    expect(sessionProjectionCache.shouldRebuild({
      cache,
      session,
      projectPathsVersion: projectPathsVersion + 1,
    })).toBe(true)
  })

  test('rebuilds on folder-state and project-path changes, not selection, layout, or graph-version changes', () => {
    const fixtures = makeProjectSessionStateFixtures()
    const session = fixtures.makeSession()
    const project = fixtures.makeProject()
    const projectPaths = [project.writeFolderPath, ...project.readPaths]
    const cache = sessionProjectionCache.create(snapshotFor({
      graph: fixtures.makeVisibilityGraph(),
      projectVersion: 10,
      session,
      project,
      projectPaths,
      projectPathsVersion: 4,
    }))

    session.selection.add('/project/public/target.md')
    session.layout.pan = { x: 10, y: 20 }
    session.layout.zoom = 2
    expect(sessionProjectionCache.shouldRebuild({ cache, session, projectPathsVersion: 4 })).toBe(false)

    session.folderState.set('/project/public', 'collapsed')
    expect(sessionProjectionCache.shouldRebuild({ cache, session, projectPathsVersion: 4 })).toBe(true)

    session.folderState.clear()
    expect(sessionProjectionCache.shouldRebuild({ cache, session, projectPathsVersion: 4 })).toBe(false)
    expect(sessionProjectionCache.shouldRebuild({ cache, session, projectPathsVersion: 5 })).toBe(true)
  })

  test('fuzzes graph, session, and project mutations against rebuild-from-scratch projection', () => {
    const fixtures = makeProjectSessionStateFixtures()
    const session = fixtures.makeSession({
      folderState: new Map([
        ['/project/public', 'expanded'],
        ['/project/secret', 'expanded'],
      ]),
    })
    const project = fixtures.makeProject()
    let model: FuzzModel = rebuildCache({
      cache: sessionProjectionCache.create(snapshotFor({
        graph: fixtures.makeVisibilityGraph(),
        session,
        project,
        projectPaths: [project.writeFolderPath, ...project.readPaths],
      })),
      graph: fixtures.makeVisibilityGraph(),
      projectVersion: 1,
      session,
      project,
      projectPaths: [project.writeFolderPath, ...project.readPaths],
      projectPathsVersion: 1,
    })
    const rng: Rng = { seed: 0xC0FFEE }

    for (let step = 1; step <= 80; step++) {
      const operation = nextInt(rng, 6)
      if (operation <= 2) {
        expect(sessionProjectionCache.shouldRebuild({
          cache: model.cache,
          session: model.session,
          projectPathsVersion: model.projectPathsVersion,
        })).toBe(false)

        const delta = makeFuzzDelta(model, rng, step)
        const event: ProjectDeltaEventInput = { delta, seq: step }
        model = {
          ...model,
          graph: applyGraphDeltaToGraph(model.graph, delta),
          projectVersion: model.projectVersion + 1,
          cache: sessionProjectionCache.advance(model.cache, event),
        }
        expectCachedProjectionToMatchRebuild(model, event)
        continue
      }

      if (operation === 3) {
        model = mutateFolderState(model, rng)
        expectCachedStateToMatchRebuild(model)
        continue
      }

      if (operation === 4) {
        model = mutateProjectPaths(model, rng)
        expectCachedStateToMatchRebuild(model)
        continue
      }

      model = mutateSelectionAndLayout(model, rng, step)
      expectCachedStateToMatchRebuild(model)
    }
  })

  test('shares one session cache across multiple observers without changing projected graph sequence', () => {
    const fixtures = makeProjectSessionStateFixtures()
    const session = fixtures.makeSession({
      folderState: new Map([
        ['/project/public', 'expanded'],
        ['/project/secret', 'expanded'],
      ]),
    })
    const project = fixtures.makeProject()
    const projectPaths = [project.writeFolderPath, ...project.readPaths]
    const observerCount = 4
    let graph = fixtures.makeVisibilityGraph()
    const isolatedCaches = Array.from(
      { length: observerCount },
      () => sessionProjectionCache.create(snapshotFor({ graph, session, project, projectPaths })),
    )
    const registry = sessionProjectionCache.createRegistry()
    const sharedLeases = Array.from(
      { length: observerCount },
      () => registry.acquire(session.id),
    )
    sharedLeases[0]!.replace(sessionProjectionCache.create(snapshotFor({ graph, session, project, projectPaths })))

    for (const [index, delta] of makeDeltaSequence(graph).entries()) {
      const event: ProjectDeltaEventInput = { delta, seq: index + 1 }
      graph = applyGraphDeltaToGraph(graph, delta)

      const isolatedSequence = isolatedCaches.map((cache, observerIndex) => {
        const nextCache = sessionProjectionCache.advance(cache, event)
        isolatedCaches[observerIndex] = nextCache
        return observedProjectedGraph(nextCache, event)
      })

      const sharedSequence = sharedLeases.map((lease) => {
        const current = lease.current()
        if (current === null) throw new Error('shared cache missing')
        const nextCache = sessionProjectionCache.advance(current, event)
        lease.replace(nextCache)
        return observedProjectedGraph(nextCache, event)
      })

      expect(sharedSequence).toEqual(isolatedSequence)
    }

    for (const lease of sharedLeases) {
      lease.release()
    }
    expect(registry.size()).toBe(0)
  })
})
