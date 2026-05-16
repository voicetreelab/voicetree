import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {afterAll, afterEach, describe, expect, it} from 'vitest'
import {
    createSession,
    getPanePid,
    hasSession,
    killSession,
    pipePaneToFile,
    sendKeys,
} from '../tmux-session-manager.ts'

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
            `bash -c 'sleep 0.2; echo HELLO; read line; echo REPLY:$line; sleep 5'`,
        )
        expect(created.pid).toBeGreaterThan(0)
        expect(await getPanePid(name)).toBe(created.pid)

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

    it('treats killing an already-dead session as success', async () => {
        const name: string = sessionName()
        await expect(killSession(name)).resolves.toBeUndefined()
        expect(await hasSession(name)).toBe(false)
    })
})
