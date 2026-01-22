/**
 * Tests for EditorStore auto-pin queue behavior
 *
 * The auto-pin queue manages editors opened for external file changes:
 * - Regular nodes: Added to FIFO queue with MAX_AUTO_PINNED_EDITORS = 1 limit
 * - Agent nodes (with agent_name in YAML): Bypass the queue entirely, no limit
 *
 * The agent node bypass logic is in FloatingEditorCRUD.createAnchoredFloatingEditor
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { NodeIdAndFilePath } from '@/pure/graph'
import {
    addToAutoPinQueue,
    removeFromAutoPinQueue,
} from './EditorStore'

// Reset module state between tests by re-importing
// Note: This is a workaround since the module uses module-level state
beforeEach(async () => {
    // Clear the queue by removing any entries
    // We call addToAutoPinQueue twice to fill, then it auto-evicts
    const dummy1: NodeIdAndFilePath = 'test-dummy-1.md'
    const dummy2: NodeIdAndFilePath = 'test-dummy-2.md'
    addToAutoPinQueue(dummy1)
    addToAutoPinQueue(dummy2)
    removeFromAutoPinQueue(dummy1)
    removeFromAutoPinQueue(dummy2)
})

describe('EditorStore auto-pin queue', () => {
    it('should return null when adding first editor (within limit)', () => {
        const result: NodeIdAndFilePath | null = addToAutoPinQueue('node1.md')
        expect(result).toBeNull()
    })

    it('should return oldest nodeId when exceeding limit', () => {
        // Add first editor (within limit of 1)
        addToAutoPinQueue('node1.md')

        // Add second editor - should return first to close
        const result: NodeIdAndFilePath | null = addToAutoPinQueue('node2.md')
        expect(result).toBe('node1.md')
    })

    it('should maintain FIFO order when multiple exceeds occur', () => {
        addToAutoPinQueue('node1.md')
        const result1: NodeIdAndFilePath | null = addToAutoPinQueue('node2.md')
        expect(result1).toBe('node1.md')

        const result2: NodeIdAndFilePath | null = addToAutoPinQueue('node3.md')
        expect(result2).toBe('node2.md')
    })

    it('should allow removal of editor from queue', () => {
        addToAutoPinQueue('node1.md')
        removeFromAutoPinQueue('node1.md')

        // Adding new editor should not evict anything since queue is empty
        const result: NodeIdAndFilePath | null = addToAutoPinQueue('node2.md')
        expect(result).toBeNull()
    })

    it('should handle removal of non-existent editor gracefully', () => {
        // Should not throw
        expect(() => removeFromAutoPinQueue('nonexistent.md')).not.toThrow()
    })
})

/**
 * Integration note:
 *
 * Agent nodes bypass this queue entirely. When createAnchoredFloatingEditor
 * is called with isAgentNode=true, it skips the addToAutoPinQueue call.
 * This means agent-created node editors remain open until manually closed,
 * with no limit on how many can be open simultaneously.
 *
 * The flow is:
 * 1. handleFSEventWithStateAndUISides detects agent_name in YAML
 * 2. Passes isAgentNode=true to createEditorForExternalNode
 * 3. Which passes to createAnchoredFloatingEditor
 * 4. Which skips addToAutoPinQueue when isAgentNode=true
 */
