import { describe, it, expect } from 'vitest'
import { mapFSEventsToGraphDelta } from './mapFSEventsToGraphDelta.ts'
import type { FSUpdate, Graph } from './index.ts'

describe('mapFSEventsToGraphDelta', () => {
  describe('Node ID preservation from fs events', () => {
    it('should strip .md extension from node ID when adding a file', () => {
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
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('test-note')
      }
    })

    it('should strip .md extension from node ID for nested paths when adding', () => {
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
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('folder/subfolder/nested')
      }
    })

    it('should strip .md extension from node ID when changing a file', () => {
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
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('updated')
      }
    })

    it('should strip .md extension from node ID when deleting a file', () => {
      const fsUpdate: FSUpdate = {
        absolutePath: '/vault/to-delete.md',
        content: '',
        eventType: 'Deleted'
      }
      const vaultPath = '/vault'
      const currentGraph: Graph = { nodes: {} }

      const delta = mapFSEventsToGraphDelta(fsUpdate, vaultPath, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('DeleteNode')
      if (delta[0].type === 'DeleteNode') {
        expect(delta[0].nodeId).toBe('to-delete')
      }
    })

    it('should strip .md extension for files with multiple dots', () => {
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
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('file.backup')
      }
    })
  })
})
