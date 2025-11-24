import { describe, it, expect } from 'vitest'
import { mapFSEventsToGraphDelta } from './mapFSEventsToGraphDelta.ts'
import type { FSUpdate, FSDelete, Graph } from './index.ts'

describe('mapFSEventsToGraphDelta', () => {
  describe('Node ID preservation from fs events', () => {
    it('should keep .md extension in node ID when adding a file', () => {
      const fsUpdate: FSUpdate = {
        absolutePath: '/vault/test-note.md',
        content: '# Test Note',
        eventType: 'Added'
      }
      const vaultPath = '/vault'
      const currentGraph: Graph = { nodes: {} }

      const delta = mapFSEventsToGraphDelta(fsUpdate, vaultPath, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('test-note.md')
      }
    })

    it('should keep .md extension in node ID for nested paths when adding', () => {
      const fsUpdate: FSUpdate = {
        absolutePath: '/vault/folder/subfolder/nested.md',
        content: '# Nested',
        eventType: 'Added'
      }
      const vaultPath = '/vault'
      const currentGraph: Graph = { nodes: {} }

      const delta = mapFSEventsToGraphDelta(fsUpdate, vaultPath, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('folder/subfolder/nested.md')
      }
    })

    it('should keep .md extension in node ID when changing a file', () => {
      const fsUpdate: FSUpdate = {
        absolutePath: '/vault/updated.md',
        content: '# Updated Content',
        eventType: 'Changed'
      }
      const vaultPath = '/vault'
      const currentGraph: Graph = { nodes: {} }

      const delta = mapFSEventsToGraphDelta(fsUpdate, vaultPath, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('updated.md')
      }
    })

    it('should keep .md extension in node ID when deleting a file', () => {
      const fsDelete: FSDelete = {
        type: 'Delete',
        absolutePath: '/vault/to-delete.md'
      }
      const vaultPath = '/vault'
      const currentGraph: Graph = { nodes: {} }

      const delta = mapFSEventsToGraphDelta(fsDelete, vaultPath, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('DeleteNode')
      if (delta[0].type === 'DeleteNode') {
        expect(delta[0].nodeId).toBe('to-delete.md')
      }
    })

    it('should keep .md extension for files with multiple dots', () => {
      const fsUpdate: FSUpdate = {
        absolutePath: '/vault/file.backup.md',
        content: '# Backup',
        eventType: 'Added'
      }
      const vaultPath = '/vault'
      const currentGraph: Graph = { nodes: {} }

      const delta = mapFSEventsToGraphDelta(fsUpdate, vaultPath, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('file.backup.md')
      }
    })
  })
})
