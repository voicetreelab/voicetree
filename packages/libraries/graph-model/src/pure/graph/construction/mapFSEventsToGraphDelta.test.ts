import { describe, it, expect } from 'vitest'
import { mapFSEventsToGraphDelta } from './mapFSEventsToGraphDelta'
import type { FSUpdate, FSDelete, Graph, GraphDelta } from '..'
import { createEmptyGraph, createGraph } from './createGraph'
import { applyGraphDeltaToGraph } from '../graphDelta/applyGraphDeltaToGraph'

describe('mapFSEventsToGraphDelta', () => {
  describe('Node ID preservation from fs events', () => {
    it('should keep .md extension in node ID for upsert operations', () => {
      const fsUpdate: FSUpdate = {
        absolutePath: '/project/test-note.md',
        content: '# Test Note',
        eventType: 'Added'
      }
      const currentGraph: Graph = createGraph({})

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsUpdate, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.absoluteFilePathIsID).toBe('/project/test-note.md')
      }
    })

    it('should keep .md extension in node ID when deleting a file', () => {
      const fsDelete: FSDelete = {
        type: 'Delete',
        absolutePath: '/project/to-delete.md'
      }
      const currentGraph: Graph = createGraph({})

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsDelete, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('DeleteNode')
      if (delta[0].type === 'DeleteNode') {
        expect(delta[0].nodeId).toBe('/project/to-delete.md')
      }
    })

    it('should keep .md extension for nested paths and multiple dots', () => {
      const fsUpdate: FSUpdate = {
        absolutePath: '/project/folder/file.backup.md',
        content: '# Backup',
        eventType: 'Added'
      }
      const currentGraph: Graph = createGraph({})

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsUpdate, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.absoluteFilePathIsID).toBe('/project/folder/file.backup.md')
      }
    })
  })

  describe('delete+add move semantics', () => {
    it('heals incoming edges when a file moves but keeps the same basename', () => {
      let currentGraph: Graph = createEmptyGraph()

      const oldPath = '/project/topic.md'
      const movedPath = '/project/archive/topic.md'

      const addOriginalTarget: FSUpdate = {
        absolutePath: oldPath,
        content: '# Topic',
        eventType: 'Added'
      }
      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta(addOriginalTarget, currentGraph)
      )

      const addSource: FSUpdate = {
        absolutePath: '/project/index.md',
        content: '# Index\n\n[[topic]]',
        eventType: 'Added'
      }
      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta(addSource, currentGraph)
      )
      expect(currentGraph.nodes['/project/index.md'].outgoingEdges[0].targetId).toBe(oldPath)

      const deleteOriginalTarget: FSDelete = {
        type: 'Delete',
        absolutePath: oldPath
      }
      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta(deleteOriginalTarget, currentGraph)
      )

      const addMovedTarget: FSUpdate = {
        absolutePath: movedPath,
        content: '# Topic',
        eventType: 'Added'
      }
      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta(addMovedTarget, currentGraph)
      )

      expect(currentGraph.nodes['/project/index.md'].outgoingEdges[0].targetId).toBe(movedPath)
    })

    it('heals incoming edges when a same-basename move is observed as add before delete', () => {
      let currentGraph: Graph = createEmptyGraph()

      const oldPath = '/project/topic.md'
      const movedPath = '/project/archive/topic.md'

      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta({
          absolutePath: oldPath,
          content: '# Topic',
          eventType: 'Added'
        }, currentGraph)
      )

      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta({
          absolutePath: '/project/index.md',
          content: '# Index\n\n[[topic]]',
          eventType: 'Added'
        }, currentGraph)
      )

      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta({
          absolutePath: movedPath,
          content: '# Topic',
          eventType: 'Added'
        }, currentGraph)
      )
      expect(currentGraph.nodes['/project/index.md'].outgoingEdges[0].targetId).toBe(oldPath)

      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta({
          type: 'Delete',
          absolutePath: oldPath
        }, currentGraph)
      )

      expect(currentGraph.nodes['/project/index.md'].outgoingEdges[0].targetId).toBe(movedPath)
    })

    it('does not redirect deleted links to a same-basename file with different content', () => {
      let currentGraph: Graph = createEmptyGraph()

      const oldPath = '/project/topic.md'
      const otherPath = '/project/archive/topic.md'

      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta({
          absolutePath: oldPath,
          content: '# Topic',
          eventType: 'Added'
        }, currentGraph)
      )

      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta({
          absolutePath: '/project/index.md',
          content: '# Index\n\n[[topic]]',
          eventType: 'Added'
        }, currentGraph)
      )

      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta({
          absolutePath: otherPath,
          content: '# Different Topic',
          eventType: 'Added'
        }, currentGraph)
      )

      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta({
          type: 'Delete',
          absolutePath: oldPath
        }, currentGraph)
      )

      expect(currentGraph.nodes['/project/index.md'].outgoingEdges[0].targetId).toBe(oldPath)
    })

    it('does not infer a reference-preserving rename when the basename changes', () => {
      let currentGraph: Graph = createEmptyGraph()

      const oldPath = '/project/topic.md'
      const renamedPath = '/project/renamed-topic.md'

      const addOriginalTarget: FSUpdate = {
        absolutePath: oldPath,
        content: '# Topic',
        eventType: 'Added'
      }
      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta(addOriginalTarget, currentGraph)
      )

      const addSource: FSUpdate = {
        absolutePath: '/project/index.md',
        content: '# Index\n\n[[topic]]',
        eventType: 'Added'
      }
      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta(addSource, currentGraph)
      )

      const deleteOriginalTarget: FSDelete = {
        type: 'Delete',
        absolutePath: oldPath
      }
      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta(deleteOriginalTarget, currentGraph)
      )

      const addRenamedTarget: FSUpdate = {
        absolutePath: renamedPath,
        content: '# Renamed Topic',
        eventType: 'Added'
      }
      currentGraph = applyGraphDeltaToGraph(
        currentGraph,
        mapFSEventsToGraphDelta(addRenamedTarget, currentGraph)
      )

      expect(currentGraph.nodes['/project/index.md'].outgoingEdges[0].targetId).toBe(oldPath)
    })
  })
})
