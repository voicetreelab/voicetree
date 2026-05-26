import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {afterAll, afterEach, describe, expect, it} from 'vitest'
import {
    buildTmuxSessionName,
    createSession,
    getSessionEnvironment,
    getPanePid,
    hasSession,
    killSession,
    listSessions,
    pipePaneToFile,
    sendKeys,
} from '../tmux/tmux-session-manager.ts'
import {shellQuote} from '../../util/shellQuote.ts'

const sessions: Set<string> = new Set<string>()
const tempDirs: Set<string> = new Set<string>()

function sessionName(): string {
    return `bf310-${randomUUID().slice(0, 8)}`
}

async function makeTempDir(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'bf310-'))
    tempDirs.add(dir)
    return dir
}

async function readIfExists(path: string): Promise<string> {
    try {
        return await readFile(path, 'utf8')
    } catch {
        return ''
    }
}

async function waitFor(assertion: () => Promise<boolean>, timeoutMs: number = 4000): Promise<void> {
    const started: number = Date.now()
    while (Date.now() - started < timeoutMs) {
        if (await assertion()) return
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('timed out waiting for condition')
}

async function cleanupSessions(): Promise<void> {
    await Promise.all([...sessions].map(async (name: string) => {
        await killSession(name)
        sessions.delete(name)
    }))
}

async function cleanupTempDirs(): Promise<void> {
    await Promise.all([...tempDirs].map(async (dir: string) => {
        await rm(dir, {recursive: true, force: true})
        tempDirs.delete(dir)
    }))
}

describe('tmux-session-manager', () => {
    afterEach(async () => {
        await cleanupSessions()
        await cleanupTempDirs()
    })

    afterAll(async () => {
        await cleanupSessions()
        await cleanupTempDirs()
    })

    it('creates, pipes, sends input to, detects, and kills a real tmux session', async () => {
        const name: string = sessionName()
        const dir: string = await makeTempDir()
        const logPath: string = join(dir, 'session.log')
        sessions.add(name)

        const created: {pid: number} = await createSession(
            name,
            `bash -c 'echo HELLO; sleep 0.2; read line; echo REPLY:$line; sleep 5'`,
        )
        expect(created.pid).toBeGreaterThan(0)
        expect(await getPanePid(name)).toBe(created.pid)

        await new Promise((resolve) => setTimeout(resolve, 100))
        await pipePaneToFile(name, logPath)
        await waitFor(async () => (await readIfExists(logPath)).includes('HELLO'))

        await sendKeys(name, 'WORLD')
        await waitFor(async () => (await readIfExists(logPath)).includes('REPLY:WORLD'))

        expect(await hasSession(name)).toBe(true)
        await killSession(name)
        sessions.delete(name)
        expect(await hasSession(name)).toBe(false)
    })

    it('passes provided environment variables into the tmux session', async () => {
        const name: string = sessionName()
        const dir: string = await makeTempDir()
        const envPath: string = join(dir, 'env.out')
        sessions.add(name)

        await createSession(
            name,
            `sh -c 'printf "%s" "$VOICETREE_TERMINAL_ID" > ${envPath}; sleep 5'`,
            {VOICETREE_TERMINAL_ID: 'BF310_TEST_VAL'},
        )

        await waitFor(async () => (await readIfExists(envPath)) === 'BF310_TEST_VAL')
    })

    it('lists tmux sessions and reads session-scoped environment variables', async () => {
        const name: string = sessionName()
        sessions.add(name)

        const created: {pid: number} = await createSession(
            name,
            'sleep 5',
            {
                AGENT_NAME: 'BF310_AGENT',
                VOICETREE_TERMINAL_ID: 'BF310_TEST_VAL',
            },
        )

        const listed = await listSessions()
        expect(listed).toContainEqual({
            sessionName: name,
            createdAtSeconds: expect.any(Number),
            panePid: created.pid,
        })

        const env: Record<string, string> = await getSessionEnvironment(name)
        expect(env.AGENT_NAME).toBe('BF310_AGENT')
        expect(env.VOICETREE_TERMINAL_ID).toBe('BF310_TEST_VAL')
    })

    it('reuses an existing tmux session without probing first when requested', async () => {
        const name: string = sessionName()
        sessions.add(name)

        const first: {pid: number; created: boolean} = await createSession(name, 'sleep 5', {}, {reuseExisting: true})
        const second: {pid: number; created: boolean} = await createSession(name, 'sleep 5', {}, {reuseExisting: true})

        expect(first.created).toBe(true)
        expect(first.pid).toBeGreaterThan(0)
        expect(second).toEqual({pid: first.pid, created: false})
    })

    it('scopes tmux session names by vault so parallel runtimes can reuse terminal IDs', async () => {
        const name: string = 'bf310-shared-terminal'
        const firstDir: string = await makeTempDir()
        const secondDir: string = await makeTempDir()
        const firstSession: string = buildTmuxSessionName(name, {VOICETREE_VAULT_PATH: firstDir})
        const secondSession: string = buildTmuxSessionName(name, {VOICETREE_VAULT_PATH: secondDir})
        sessions.add(firstSession)
        sessions.add(secondSession)

        await createSession(
            name,
            `sh -c 'printf first > ${join(firstDir, 'session.out')}; sleep 5'`,
            {VOICETREE_VAULT_PATH: firstDir},
        )
        await createSession(
            name,
            `sh -c 'printf second > ${join(secondDir, 'session.out')}; sleep 5'`,
            {VOICETREE_VAULT_PATH: secondDir},
        )

        expect(firstSession).not.toBe(secondSession)
        expect(await hasSession(firstSession)).toBe(true)
        expect(await hasSession(secondSession)).toBe(true)
        await waitFor(async () => (await readIfExists(join(firstDir, 'session.out'))) === 'first')
        await waitFor(async () => (await readIfExists(join(secondDir, 'session.out'))) === 'second')
    })

    it('treats killing an already-dead session as success', async () => {
        const name: string = sessionName()
        await expect(killSession(name)).resolves.toBeUndefined()
        expect(await hasSession(name)).toBe(false)
    })
})
