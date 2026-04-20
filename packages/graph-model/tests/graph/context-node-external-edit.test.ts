/**
 * Integration test for the H3 fix: context-node bypass in isOurRecentDelta.
 *
 * Pre-fix bug: when the app marks a recent delta on a context node (e.g. via
 * MCP create_graph or spawn_agent), any external write to that same file
 * within 10s was silently suppressed because the bypass branch returned true
 * without comparing content. Reproduces user's "agent edits don't go through"
 * scenario for context nodes.
 *
 * Post-fix: content comparison runs for ALL upserts; only true echoes (same
 * normalized content) are suppressed.
 */

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createEmptyGraph} from '../../src/pure/graph/createGraph'
import {setGraph, getNode} from '../../src/state/graph-store'
import {clearRecentDeltas, markRecentDelta} from '../../src/state/recent-deltas-store'
import {clearWatchFolderState, setProjectRootWatchedDirectory} from '../../src/state/watch-folder-store'
import {initGraphModel} from '../../src/types'
import {handleFSEventWithStateAndUISides} from '../../src/graph/handleFSEvent'
import {saveVaultConfigForDirectory} from '../../src/watch-folder/voicetree-config-io'
import type {NodeDelta, GraphNode, NodeUIMetadata} from '../../src/pure/graph'

function makeContextNode(absolutePath: string, content: string): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: absolutePath,
        contentWithoutYamlOrLinks: content,
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: true,
        } as NodeUIMetadata,
    }
}

describe('context-node external edit propagates to graph-store', () => {
    let appSupportPath: string
    let projectRootPath: string
    let tempRootPath: string
    let tempVaultPath: string

    beforeEach(async () => {
        tempRootPath = mkdtempSync(path.join(tmpdir(), 'vt-ctxnode-fix-'))
        appSupportPath = path.join(tempRootPath, 'app-support')
        projectRootPath = path.join(tempRootPath, 'project')
        tempVaultPath = path.join(projectRootPath, 'vault')
        mkdirSync(tempVaultPath, {recursive: true})

        initGraphModel({appSupportPath})
        clearWatchFolderState()
        setProjectRootWatchedDirectory(projectRootPath)
        await saveVaultConfigForDirectory(projectRootPath, {
            writePath: tempVaultPath,
            readPaths: [],
        })
        setGraph(createEmptyGraph())
        clearRecentDeltas()
    })

    afterEach(() => {
        clearRecentDeltas()
        clearWatchFolderState()
        setGraph(createEmptyGraph())
        rmSync(tempRootPath, {recursive: true, force: true})
    })

    it('external write to context node is NOT suppressed when content differs from our recent mark', async () => {
        const ctxPath: string = path.join(tempVaultPath, 'task-foo_context.md')

        // 1. App-side: create the context node, mark recent delta, populate graph-store
        const appContent: string = '---\nisContextNode: true\n---\n# context\n\napp-generated body'
        const appDelta: NodeDelta = {
            type: 'UpsertNode',
            nodeToUpsert: makeContextNode(ctxPath, 'app-generated body'),
            previousNode: O.none,
        }
        markRecentDelta(appDelta)
        // Seed graph-store with the app's view of the node
        writeFileSync(ctxPath, appContent, 'utf8')
        handleFSEventWithStateAndUISides(
            {absolutePath: ctxPath, content: appContent, eventType: 'Added'},
            projectRootPath,
        )

        // Sanity: graph-store has the app content
        await new Promise(resolve => setTimeout(resolve, 50))
        const seeded: GraphNode | undefined = getNode(ctxPath)
        expect(seeded?.contentWithoutYamlOrLinks).toContain('app-generated body')

        // 2. External agent writes COMPLETELY DIFFERENT content to the same file
        //    within the 10s TTL of markRecentDelta
        const agentContent: string = '---\nisContextNode: true\n---\n# context\n\nAGENT_NEW_CONTENT_marker'
        writeFileSync(ctxPath, agentContent, 'utf8')
        handleFSEventWithStateAndUISides(
            {absolutePath: ctxPath, content: agentContent, eventType: 'Changed'},
            projectRootPath,
        )

        // 3. Pre-fix: graph-store still shows 'app-generated body' (suppressed).
        //    Post-fix: graph-store now has the agent's content.
        await new Promise(resolve => setTimeout(resolve, 100))
        const updated: GraphNode | undefined = getNode(ctxPath)
        expect(updated?.contentWithoutYamlOrLinks).toContain('AGENT_NEW_CONTENT_marker')
        expect(updated?.contentWithoutYamlOrLinks).not.toContain('app-generated body')
    })

    it('genuine echo (same content) still gets suppressed for context nodes', async () => {
        const ctxPath: string = path.join(tempVaultPath, 'task-bar_context.md')
        const content: string = '---\nisContextNode: true\n---\n# context\n\nstable body'

        // Seed
        writeFileSync(ctxPath, content, 'utf8')
        handleFSEventWithStateAndUISides(
            {absolutePath: ctxPath, content, eventType: 'Added'},
            projectRootPath,
        )

        // Mark a recent delta (simulating the app's own write)
        const appDelta: NodeDelta = {
            type: 'UpsertNode',
            nodeToUpsert: makeContextNode(ctxPath, 'stable body'),
            previousNode: O.none,
        }
        markRecentDelta(appDelta)

        // Echo event with identical content — should be suppressed (no spurious updates)
        handleFSEventWithStateAndUISides(
            {absolutePath: ctxPath, content, eventType: 'Changed'},
            projectRootPath,
        )

        await new Promise(resolve => setTimeout(resolve, 50))
        const after: GraphNode | undefined = getNode(ctxPath)
        expect(after?.contentWithoutYamlOrLinks).toContain('stable body')
    })
})
