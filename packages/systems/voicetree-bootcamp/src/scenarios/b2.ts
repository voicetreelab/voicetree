/**
 * B2 — agent lifecycle (spawn → observe → send → close).
 *
 * Single-node caching vault; agent must drive the entire `vt agent *` surface
 * with a follow-up about write-behind threaded between spawn and close.
 */
import * as path from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import type {ScenarioSpec, SuccessResult, ShimLogEntry} from '../types.ts'
import {matchesVerb} from '../shim-log.ts'
import {loadShimLog, writeFile} from './_helpers.ts'

const NODE_ID = 'caching-001'
const NODE_FILE = 'notes-on-caching.md'

const NODE_BODY = `---
color: blue
isContextNode: false
agent_name: Pat
id: ${NODE_ID}
---
# Caching strategy
Need to write up the read-through vs write-through tradeoff with examples.
`

const TASK_PROMPT = `There is one progress node in this vault about caching strategy. I want a
subagent to draft the read-through vs write-through comparison the note
mentions, then I want to follow up and ask it to add a third option
(write-behind) before we wrap.

Spawn the subagent against that node. Once it's running, check that it's
listed as active and peek at its initial output. Then send it the follow-up
about adding write-behind. Wait for it to finish, then close it.

Use \`vt --help\` to discover the CLI surface.`

export const b2: ScenarioSpec = {
    id: 'B2',
    name: 'agent lifecycle (spawn / observe / send / close)',
    async setup(vaultDir) {
        await writeFile(path.join(getProjectDotVoicetreePath(vaultDir), '.keep'), '')
        await writeFile(path.join(vaultDir, NODE_FILE), NODE_BODY)
    },
    taskPrompt: TASK_PROMPT,
    expectedCommands: [
        {verb: 'agent spawn'},
        {verb: 'agent list'},
        {verb: 'agent output'},
        {verb: 'agent send'},
        {verb: 'agent wait'},
        {verb: 'agent close'},
    ],
    async successCriteria(vaultDir): Promise<SuccessResult> {
        const shimLog = await loadShimLog(vaultDir)
        const spawnEntries = shimLog.filter(
            (e) => matchesVerb(e, 'agent spawn') && e.exitCode === 0,
        )
        const sendEntries = shimLog.filter(
            (e) => matchesVerb(e, 'agent send') && e.exitCode === 0,
        )
        const closeEntries = shimLog.filter(
            (e) => matchesVerb(e, 'agent close') && e.exitCode === 0,
        )

        if (spawnEntries.length !== 1) {
            return {
                passed: false,
                detail: `expected exactly 1 successful agent spawn; saw ${spawnEntries.length}`,
            }
        }
        if (!spawnTargetsNode(spawnEntries[0], NODE_ID)) {
            return {
                passed: false,
                detail: `agent spawn did not target --node ${NODE_ID} (argv: ${spawnEntries[0].argv.join(' ')})`,
            }
        }
        if (closeEntries.length !== 1) {
            return {
                passed: false,
                detail: `expected exactly 1 successful agent close; saw ${closeEntries.length}`,
            }
        }
        const spawnAt = spawnEntries[0].timestampMs
        const closeAt = closeEntries[0].timestampMs
        const sendWriteBehind = sendEntries.find(
            (e) =>
                e.timestampMs > spawnAt &&
                e.timestampMs < closeAt &&
                e.argv.join(' ').toLowerCase().includes('write-behind'),
        )
        if (sendWriteBehind === undefined) {
            return {
                passed: false,
                detail: 'no agent send mentioning "write-behind" between spawn and close',
            }
        }

        return {
            passed: true,
            detail: `agent spawn → send(write-behind) → close completed cleanly for node ${NODE_ID}`,
        }
    },
    budgets: {
        tokens: 5000,
        toolCalls: 8,
        vtInvocations: 8,
        seconds: 45,
    },
}

function spawnTargetsNode(entry: ShimLogEntry, nodeId: string): boolean {
    const idx = entry.argv.indexOf('--node')
    if (idx < 0 || idx + 1 >= entry.argv.length) return false
    return entry.argv[idx + 1] === nodeId
}
