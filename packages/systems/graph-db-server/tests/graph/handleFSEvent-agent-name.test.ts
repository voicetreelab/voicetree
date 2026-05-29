import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { initGraphModel } from '@vt/graph-model'
import { createEmptyGraph } from '@vt/graph-model/graph'
import { getGraph, getNode, setGraph } from '../../src/state/graph-store'
import { clearRecentDeltas } from '../../src/state/recent-deltas-store'
import { handleFSEventWithStateAndUISides } from '../../src/data/graph/watching/handleFSEvent'
import type { FSUpdate } from '@vt/graph-model'

vi.mock('../../src/watch-folder/paths/project-allowlist', () => ({
    getProjectPaths: vi.fn(async () => []),
}))

describe('handleFSEvent agent_name detection', () => {
    let agentNameCallback: ReturnType<typeof vi.fn>

    beforeEach(() => {
        agentNameCallback = vi.fn()
        clearRecentDeltas()
        setGraph(createEmptyGraph())
        initGraphModel({ onFSNodeWithAgentName: agentNameCallback })
    })

    it('fires onFSNodeWithAgentName for a new node with agent_name frontmatter', async () => {
        const content = `---
color: blue
agent_name: Victor
---
# Progress Node
Some content here.`

        const fsEvent: FSUpdate = {
            absolutePath: '/project/progress-node.md',
            content,
            eventType: 'Added',
        }

        handleFSEventWithStateAndUISides(fsEvent, '/project')
        await vi.waitFor(() => expect(agentNameCallback).toHaveBeenCalledTimes(1), { timeout: 2000 })

        expect(agentNameCallback).toHaveBeenCalledWith(
            'Victor',
            '/project/progress-node.md',
            'Progress Node',
        )

        const node = getNode('/project/progress-node.md')
        expect(node).toBeDefined()
        expect(node!.kind).toBe('leaf')
        expect(node!.nodeUIMetadata.color).toEqual(O.some('blue'))
    })

    it('does not fire callback for a node without agent_name', async () => {
        const content = `---
color: green
---
# Regular Node
No agent here.`

        const fsEvent: FSUpdate = {
            absolutePath: '/project/regular-node.md',
            content,
            eventType: 'Added',
        }

        handleFSEventWithStateAndUISides(fsEvent, '/project')
        await new Promise(r => setTimeout(r, 200))

        expect(agentNameCallback).not.toHaveBeenCalled()

        const node = getNode('/project/regular-node.md')
        expect(node).toBeDefined()
        expect(node!.nodeUIMetadata.color).toEqual(O.some('green'))
    })

    it('does not fire callback for an update to an existing node', async () => {
        const initialContent = `---
agent_name: Amit
---
# First Version`

        const fsEvent1: FSUpdate = {
            absolutePath: '/project/existing-node.md',
            content: initialContent,
            eventType: 'Added',
        }
        handleFSEventWithStateAndUISides(fsEvent1, '/project')
        await vi.waitFor(() => expect(agentNameCallback).toHaveBeenCalledTimes(1), { timeout: 2000 })

        agentNameCallback.mockClear()

        const updatedContent = `---
agent_name: Amit
---
# Updated Version
More content.`

        const fsEvent2: FSUpdate = {
            absolutePath: '/project/existing-node.md',
            content: updatedContent,
            eventType: 'Changed',
        }
        handleFSEventWithStateAndUISides(fsEvent2, '/project')
        await new Promise(r => setTimeout(r, 200))

        expect(agentNameCallback).not.toHaveBeenCalled()

        const node = getNode('/project/existing-node.md')
        expect(node).toBeDefined()
        expect(node!.contentWithoutYamlOrLinks).toContain('Updated Version')
    })
})
