// BF-382 — black-box behaviour of the daemon's agent metrics store against
// a real tmpdir vault. No internal mocks: real fs.writeFile, real
// fs.readFile, real `<vault>/.voicetree/agent_metrics.json`.

import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
    AGENT_METRICS_FILENAME,
    appendTokenMetrics,
    getSessions,
    type SessionMetric,
} from '../agentMetricsStore.ts'

interface Harness {
    readonly vault: string
    readonly metricsPath: string
}

async function startHarness(): Promise<Harness> {
    const root: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-metricstore-')))
    const vault: string = join(root, 'vault')
    await mkdir(vault, {recursive: true})
    return {
        vault,
        metricsPath: join(vault, '.voicetree', AGENT_METRICS_FILENAME),
    }
}

describe('agentMetricsStore', (): void => {
    let h: Harness

    beforeEach(async (): Promise<void> => {
        h = await startHarness()
    })

    afterEach(async (): Promise<void> => {
        await rm(h.vault, {recursive: true, force: true})
    })

    it('returns empty sessions for a fresh vault (no file on disk)', async (): Promise<void> => {
        const sessions: readonly SessionMetric[] = await getSessions(h.vault)
        expect(sessions).toEqual([])
    })

    it('appendTokenMetrics writes <vault>/.voicetree/agent_metrics.json with the session', async (): Promise<void> => {
        await appendTokenMetrics(
            h.vault,
            'session-abc',
            {input: 100, output: 200, cacheRead: 50},
            0.0123,
        )

        const text: string = await readFile(h.metricsPath, 'utf8')
        const parsed: {sessions: SessionMetric[]} = JSON.parse(text)
        expect(parsed.sessions).toHaveLength(1)
        expect(parsed.sessions[0].sessionId).toBe('session-abc')
        expect(parsed.sessions[0].tokens).toEqual({input: 100, output: 200, cacheRead: 50})
        expect(parsed.sessions[0].costUsd).toBe(0.0123)
        expect(parsed.sessions[0].agentName).toBe('Claude')
        expect(parsed.sessions[0].contextNode).toBe('unknown')
        expect(typeof parsed.sessions[0].startTime).toBe('string')
        expect(typeof parsed.sessions[0].durationMs).toBe('number')
    })

    it('appendTokenMetrics with the same sessionId upserts instead of duplicating', async (): Promise<void> => {
        await appendTokenMetrics(h.vault, 'session-xyz', {input: 10, output: 20}, 0.001)
        await appendTokenMetrics(h.vault, 'session-xyz', {input: 30, output: 40, cacheRead: 5}, 0.005)

        const sessions: readonly SessionMetric[] = await getSessions(h.vault)
        expect(sessions).toHaveLength(1)
        expect(sessions[0].sessionId).toBe('session-xyz')
        expect(sessions[0].tokens).toEqual({input: 30, output: 40, cacheRead: 5})
        expect(sessions[0].costUsd).toBe(0.005)
    })

    it('appendTokenMetrics preserves terminal-registered metadata on upsert', async (): Promise<void> => {
        // Simulate a pre-existing session created by the terminal registry
        // (Voicetree-side spawn flow), then have the OTLP receiver land a
        // token update on top. The merged record must keep the terminal's
        // agentName / contextNode rather than overwriting with the OTLP
        // defaults.
        await mkdir(join(h.vault, '.voicetree'), {recursive: true})
        const seed: SessionMetric = {
            sessionId: 'terminal-1',
            agentName: 'Hana',
            contextNode: 'friday/task.md',
            startTime: '2026-05-26T10:00:00.000Z',
        }
        await writeFile(h.metricsPath, JSON.stringify({sessions: [seed]}, null, 2), 'utf8')

        await appendTokenMetrics(h.vault, 'terminal-1', {input: 11, output: 22}, 0.0099)

        const sessions: readonly SessionMetric[] = await getSessions(h.vault)
        expect(sessions).toHaveLength(1)
        expect(sessions[0].sessionId).toBe('terminal-1')
        expect(sessions[0].agentName).toBe('Hana')
        expect(sessions[0].contextNode).toBe('friday/task.md')
        expect(sessions[0].startTime).toBe('2026-05-26T10:00:00.000Z')
        expect(sessions[0].tokens).toEqual({input: 11, output: 22})
        expect(sessions[0].costUsd).toBe(0.0099)
    })

    it('two distinct sessions accumulate as separate entries', async (): Promise<void> => {
        await appendTokenMetrics(h.vault, 'session-a', {input: 1, output: 2}, 0.0001)
        await appendTokenMetrics(h.vault, 'session-b', {input: 3, output: 4}, 0.0002)

        const sessions: readonly SessionMetric[] = await getSessions(h.vault)
        const ids: readonly string[] = sessions.map((s: SessionMetric): string => s.sessionId)
        expect(ids).toEqual(['session-a', 'session-b'])
    })

    it('getSessions returns [] when the on-disk JSON is malformed', async (): Promise<void> => {
        await mkdir(join(h.vault, '.voicetree'), {recursive: true})
        await writeFile(h.metricsPath, '{not json', 'utf8')

        const sessions: readonly SessionMetric[] = await getSessions(h.vault)
        expect(sessions).toEqual([])
    })

    it('getSessions discards entries missing required fields', async (): Promise<void> => {
        await mkdir(join(h.vault, '.voicetree'), {recursive: true})
        const malformed: unknown = {
            sessions: [
                {sessionId: 'ok', agentName: 'a', contextNode: 'c', startTime: 't'},
                {sessionId: 42, agentName: 'a', contextNode: 'c', startTime: 't'}, // wrong type
                {sessionId: 'orphan'}, // missing fields
            ],
        }
        await writeFile(h.metricsPath, JSON.stringify(malformed, null, 2), 'utf8')

        const sessions: readonly SessionMetric[] = await getSessions(h.vault)
        expect(sessions).toHaveLength(1)
        expect(sessions[0].sessionId).toBe('ok')
    })
})
