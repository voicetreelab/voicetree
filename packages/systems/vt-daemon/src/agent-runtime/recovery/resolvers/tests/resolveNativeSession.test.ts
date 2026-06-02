import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {defaultResolveNativeSession} from '../resolveNativeSession'

/**
 * End-to-end coverage for the native-session dispatcher against REAL on-disk
 * fixtures (no resolver mocking). The point of these tests is B1: the resolver
 * recency window must equal the 7-day discovery horizon, so a transcript/thread
 * that died ~3 days ago (within 7d, beyond the old hardcoded 24h) still
 * resolves on a Resume click instead of silently failing.
 */

const TERMINAL = 'BigHead'
const PROJECT = '/project/root'
const TASK = '/project/root/task.md'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const THREE_DAYS_MS = 3 * MS_PER_DAY

const MARKER_BLOCK =
    `VOICETREE_TERMINAL_ID = ${TERMINAL}\nVOICETREE_PROJECT_PATH = ${PROJECT}\nTASK_NODE_PATH = ${TASK}`

const envSnapshot: Record<string, string | undefined> = {}
const TOUCHED_ENV = [
    'VOICETREE_CLAUDE_PROJECTS_DIR',
    'VOICETREE_CODEX_STATE_DB',
    'VOICETREE_RECOVERY_HORIZON_DAYS',
] as const

let tmpDir: string

beforeEach(() => {
    for (const key of TOUCHED_ENV) envSnapshot[key] = process.env[key]
    // Pin the horizon to its 7-day default so the assertion does not depend on
    // an ambient VOICETREE_RECOVERY_HORIZON_DAYS in the runner's environment.
    process.env.VOICETREE_RECOVERY_HORIZON_DAYS = '7'
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'resolve-native-'))
})

afterEach(() => {
    for (const key of TOUCHED_ENV) {
        if (envSnapshot[key] === undefined) delete process.env[key]
        else process.env[key] = envSnapshot[key]
    }
    rmSync(tmpDir, {recursive: true, force: true})
})

describe('defaultResolveNativeSession — recency window aligns with the 7-day horizon', () => {
    it('resolves a Claude transcript whose pane died ~3 days ago (within 7d, beyond the old 24h)', async () => {
        const projectsDir: string = path.join(tmpDir, 'claude-projects')
        const encoded: string = path.join(projectsDir, 'encoded-project')
        mkdirSync(encoded, {recursive: true})
        const transcript: string = path.join(encoded, 'session-aged.jsonl')
        const record = {
            sessionId: 'claude-aged-session',
            type: 'user',
            message: {role: 'user', content: `task prompt\n${MARKER_BLOCK}`},
        }
        writeFileSync(transcript, `${JSON.stringify(record)}\n`, 'utf8')
        const threeDaysAgoSec: number = (Date.now() - THREE_DAYS_MS) / 1000
        utimesSync(transcript, threeDaysAgoSec, threeDaysAgoSec)
        process.env.VOICETREE_CLAUDE_PROJECTS_DIR = projectsDir

        const result = await defaultResolveNativeSession({
            cliType: 'claude',
            terminalId: TERMINAL,
            projectRoot: PROJECT,
            taskNodePath: TASK,
        })

        expect(result).toEqual({
            kind: 'found',
            sessionId: 'claude-aged-session',
            providerStorePath: transcript,
        })
    })

    it('resolves a Codex thread last updated ~3 days ago (within 7d, beyond the old 24h)', async () => {
        const dbPath: string = path.join(tmpDir, 'state_5.sqlite')
        const db = new DatabaseSync(dbPath)
        db.exec(
            'CREATE TABLE threads (id TEXT, first_user_message TEXT, cwd TEXT, ' +
            'created_at_ms INTEGER, updated_at_ms INTEGER, rollout_path TEXT)',
        )
        const updatedAt: number = Date.now() - THREE_DAYS_MS
        const insert = db.prepare(
            'INSERT INTO threads (id, first_user_message, cwd, created_at_ms, updated_at_ms, rollout_path) ' +
            'VALUES (?, ?, ?, ?, ?, ?)',
        )
        insert.run(
            'codex-aged-thread',
            `header\n${MARKER_BLOCK}`,
            PROJECT,
            updatedAt - 60_000,
            updatedAt,
            '/rollouts/aged.jsonl',
        )
        db.close()
        process.env.VOICETREE_CODEX_STATE_DB = dbPath

        const result = await defaultResolveNativeSession({
            cliType: 'codex',
            terminalId: TERMINAL,
            projectRoot: PROJECT,
            taskNodePath: TASK,
        })

        expect(result).toEqual({
            kind: 'found',
            sessionId: 'codex-aged-thread',
            providerStorePath: '/rollouts/aged.jsonl',
        })
    })
})
