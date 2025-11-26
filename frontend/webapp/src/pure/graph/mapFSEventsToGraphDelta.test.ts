import { describe, it, expect } from 'vitest'
import { mapFSEventsToGraphDelta } from './mapFSEventsToGraphDelta'
import type { FSUpdate, FSDelete, Graph } from './index'

describe('mapFSEventsToGraphDelta', () => {
  describe('Node ID preservation from fs events', () => {
    it('should keep .md extension in node ID for upsert operations', () => {
      const fsUpdate: FSUpdate = {
        absolutePath: '/vault/test-note.md',
        content: '# Test Note',
        eventType: 'Added'
      }
      const vaultPath: "/vault" = '/vault'
      const currentGraph: Graph = { nodes: {} }

      const delta: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphDelta = mapFSEventsToGraphDelta(fsUpdate, vaultPath, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('test-note.md')
      }
    })

    it('should keep .md extension in node ID when deleting a file', () => {
      const fsDelete: FSDelete = {
        type: 'Delete',
        absolutePath: '/vault/to-delete.md'
      }
      const vaultPath: "/vault" = '/vault'
      const currentGraph: Graph = { nodes: {} }

      const delta: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphDelta = mapFSEventsToGraphDelta(fsDelete, vaultPath, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('DeleteNode')
      if (delta[0].type === 'DeleteNode') {
        expect(delta[0].nodeId).toBe('to-delete.md')
      }
    })

    it('should keep .md extension for nested paths and multiple dots', () => {
      const fsUpdate: FSUpdate = {
        absolutePath: '/vault/folder/file.backup.md',
        content: '# Backup',
        eventType: 'Added'
      }
      const vaultPath: "/vault" = '/vault'
      const currentGraph: Graph = { nodes: {} }

      const delta: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphDelta = mapFSEventsToGraphDelta(fsUpdate, vaultPath, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('folder/file.backup.md')
      }
    })
  })
})
