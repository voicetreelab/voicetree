import {rm} from 'node:fs/promises'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
    captureGraphCreate,
    startStubDaemon,
    type CapturedRun,
    type StubDaemon,
} from './graphCreateHarness'

const TERMINAL_ID: string = 'ctx-nodes/caller.md-terminal-0'
const TOOL_RESULT = {
    success: true,
    nodes: [{id: 'n1', path: '/project/write/live-node.md', status: 'ok'}],
}

function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[key]
    } else {
        process.env[key] = value
    }
}

describe('graph create live output path', () => {
    let originalStdoutIsTTY: PropertyDescriptor | undefined
    let savedDaemonUrl: string | undefined
    let savedProjectPath: string | undefined
    let savedWritePath: string | undefined
    let stub: StubDaemon

    beforeEach(async () => {
        originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
        Object.defineProperty(process.stdout, 'isTTY', {value: false, configurable: true})
        savedDaemonUrl = process.env.VOICETREE_DAEMON_URL
        savedProjectPath = process.env.VOICETREE_PROJECT_PATH
        savedWritePath = process.env.VOICETREE_WRITE_PATH
        stub = await startStubDaemon(TOOL_RESULT)
        process.env.VOICETREE_DAEMON_URL = stub.url
        process.env.VOICETREE_PROJECT_PATH = stub.projectPath
    })

    afterEach(async () => {
        if (originalStdoutIsTTY) {
            Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
        }
        restoreEnv('VOICETREE_DAEMON_URL', savedDaemonUrl)
        restoreEnv('VOICETREE_PROJECT_PATH', savedProjectPath)
        restoreEnv('VOICETREE_WRITE_PATH', savedWritePath)
        await stub.stop()
        await rm(stub.projectPath, {recursive: true, force: true})
    })

    it('forwards VOICETREE_WRITE_PATH as the default live outputPath', async () => {
        process.env.VOICETREE_WRITE_PATH = '/project/write'

        const result: CapturedRun = await captureGraphCreate(
            ['--node', 'Live Node::Created from live mode::Needed marker present.', '--status', 'working'],
            stub.projectPath,
            {terminalId: TERMINAL_ID},
        )

        expect(result.exitCode).toBeNull()
        expect(stub.requests).toHaveLength(1)
        expect(stub.requests[0].method).toBe('create_graph')
        expect(stub.requests[0].params).toMatchObject({
            callerTerminalId: TERMINAL_ID,
            outputPath: '/project/write',
            agentStatus: 'working',
        })
    })

    it('omits outputPath when VOICETREE_WRITE_PATH is unset', async () => {
        delete process.env.VOICETREE_WRITE_PATH

        const result: CapturedRun = await captureGraphCreate(
            ['--node', 'Live Node::Created from live mode::Needed marker present.', '--status', 'working'],
            stub.projectPath,
            {terminalId: TERMINAL_ID},
        )

        expect(result.exitCode).toBeNull()
        expect(stub.requests).toHaveLength(1)
        expect(stub.requests[0].params).not.toHaveProperty('outputPath')
    })
})
