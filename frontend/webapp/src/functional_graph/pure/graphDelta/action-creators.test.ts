import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {
  createCreateNodeAction,
  createUpdateNodeAction,
  createDeleteNodeAction
} from '@/functional_graph/pure/action-creators'

describe('action-creators', () => {
  describe('createCreateNodeAction', () => {
    it('should create a CreateNode action without position', () => {
      const action = createCreateNodeAction('node1', '# Test GraphNode')

      expect(action).toEqual({
        type: 'CreateNode',
        nodeId: 'node1',
        content: '# Test GraphNode',
        position: O.none
      })
    })

    it('should create a CreateNode action with position', () => {
      const action = createCreateNodeAction('node1', '# Test GraphNode', { x: 100, y: 200 })

      expect(action.type).toBe('CreateNode')
      expect(action.nodeId).toBe('node1')
      expect(action.content).toBe('# Test GraphNode')
      expect(O.isSome(action.position)).toBe(true)
      if (O.isSome(action.position)) {
        expect(action.position.value).toEqual({ x: 100, y: 200 })
      }
    })

    it('should be pure - same input produces same output', () => {
      const action1 = createCreateNodeAction('node1', '# Test')
      const action2 = createCreateNodeAction('node1', '# Test')

      expect(action1).toEqual(action2)
    })

    it('should be pure with position - same input produces same output', () => {
      const position = { x: 50, y: 75 }
      const action1 = createCreateNodeAction('node1', '# Test', position)
      const action2 = createCreateNodeAction('node1', '# Test', position)

      expect(action1).toEqual(action2)
    })

    it('should handle empty content', () => {
      const action = createCreateNodeAction('empty', '')

      expect(action.content).toBe('')
      expect(action.nodeId).toBe('empty')
    })

    it('should handle multiline markdown content', () => {
      const content = `# Title

## Subtitle

Some content here.
- List item 1
- List item 2`

      const action = createCreateNodeAction('multiline', content)

      expect(action.content).toBe(content)
    })
  })

  describe('createUpdateNodeAction', () => {
    it('should create an UpdateNode action', () => {
      const action = createUpdateNodeAction('node1', '# Updated Content')

      expect(action).toEqual({
        type: 'UpdateNode',
        nodeId: 'node1',
        content: '# Updated Content'
      })
    })

    it('should be pure - same input produces same output', () => {
      const action1 = createUpdateNodeAction('node1', '# Test')
      const action2 = createUpdateNodeAction('node1', '# Test')

      expect(action1).toEqual(action2)
    })

    it('should handle empty content', () => {
      const action = createUpdateNodeAction('node1', '')

      expect(action.content).toBe('')
    })

    it('should handle complex markdown', () => {
      const content = `# Complex

Links: [[other-node]]
Code: \`const x = 1\`

\`\`\`typescript
function test() {
  return 42;
}
\`\`\`
`

      const action = createUpdateNodeAction('complex', content)

      expect(action.content).toBe(content)
    })
  })

  describe('createDeleteNodeAction', () => {
    it('should create a DeleteNode action', () => {
      const action = createDeleteNodeAction('node1')

      expect(action).toEqual({
        type: 'DeleteNode',
        nodeId: 'node1'
      })
    })

    it('should be pure - same input produces same output', () => {
      const action1 = createDeleteNodeAction('node1')
      const action2 = createDeleteNodeAction('node1')

      expect(action1).toEqual(action2)
    })

    it('should handle different node IDs', () => {
      const action1 = createDeleteNodeAction('first')
      const action2 = createDeleteNodeAction('second')

      expect(action1.nodeId).toBe('first')
      expect(action2.nodeId).toBe('second')
      expect(action1).not.toEqual(action2)
    })
  })

  describe('action type discrimination', () => {
    it('should create actions with distinct types', () => {
      const createAction = createCreateNodeAction('node1', 'content')
      const updateAction = createUpdateNodeAction('node1', 'content')
      const deleteAction = createDeleteNodeAction('node1')

      expect(createAction.type).toBe('CreateNode')
      expect(updateAction.type).toBe('UpdateNode')
      expect(deleteAction.type).toBe('DeleteNode')

      // TypeScript discriminated union should work
      expect(createAction.type).not.toBe(updateAction.type)
      expect(createAction.type).not.toBe(deleteAction.type)
      expect(updateAction.type).not.toBe(deleteAction.type)
    })
  })

  describe('immutability', () => {
    it('should not mutate input objects', () => {
      const position = { x: 10, y: 20 }
      const originalPosition = { ...position }

      createCreateNodeAction('node1', 'content', position)

      expect(position).toEqual(originalPosition)
    })
  })
})
