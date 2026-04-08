import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const mocks = vi.hoisted(() => ({
    callMcpToolMock: vi.fn(),
    outputMock: vi.fn(),
    errorMock: vi.fn((message: string): never => {
        throw new Error(message)
    }),
    stdinPayload: undefined as string | undefined,
}))

vi.mock('../mcp-client.ts', () => ({
    callMcpTool: mocks.callMcpToolMock,
}))

vi.mock('../output.ts', () => ({
    error: mocks.errorMock,
    output: mocks.outputMock,
    isJsonMode: () => false,
}))

vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs')

    return {
        ...actual,
        readFileSync(path: Parameters<typeof actual.readFileSync>[0], options?: Parameters<typeof actual.readFileSync>[1]) {
            if (path === 0 && mocks.stdinPayload !== undefined) {
                return mocks.stdinPayload
            }

            return actual.readFileSync(path, options)
        },
    }
})

import {graphCreate} from './graph.ts'

function setStdinIsTTY(value: boolean): void {
    Object.defineProperty(process.stdin, 'isTTY', {
        value,
        configurable: true,
    })
}

describe('graphCreate mode selection', () => {
    const originalCwd: string = process.cwd()
    const stdinDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    const tempDirs: string[] = []

    beforeEach(() => {
        mocks.stdinPayload = undefined
        setStdinIsTTY(true)
        mocks.callMcpToolMock.mockReset()
        mocks.outputMock.mockReset()
        mocks.errorMock.mockClear()
    })

    afterEach(() => {
        process.chdir(originalCwd)

        if (stdinDescriptor) {
            Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor)
        } else {
            setStdinIsTTY(true)
        }

        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, {recursive: true, force: true})
        }
    })

    it('selects filesystem-native mode before terminal enforcement for markdown file inputs', async () => {
        const tempDir: string = mkdtempSync(join(tmpdir(), 'vt-graph-create-'))
        tempDirs.push(tempDir)
        process.chdir(tempDir)

        writeFileSync('existing-node.md', '# Existing Node\n\nParent summary\n', 'utf8')
        writeFileSync('test-node.md', '# Test Node\n\nChild summary\n', 'utf8')

        await expect(
            graphCreate(3002, undefined, ['./test-node.md', '--parent', 'existing-node.md'])
        ).resolves.toBeUndefined()

        expect(mocks.callMcpToolMock).not.toHaveBeenCalled()
        expect(mocks.errorMock).not.toHaveBeenCalledWith('This command requires --terminal or VOICETREE_TERMINAL_ID')
    })

    it('keeps stdin JSON create_graph requests on the MCP-backed live path', async () => {
        setStdinIsTTY(false)
        mocks.stdinPayload = JSON.stringify({
            callerTerminalId: 'term-123',
            nodes: [
                {
                    filename: 'progress',
                    title: 'Progress',
                    summary: 'Short update',
                },
            ],
        })
        mocks.callMcpToolMock.mockResolvedValue({
            success: true,
            nodes: [],
        })

        await expect(graphCreate(3002, undefined, [])).resolves.toBeUndefined()

        expect(mocks.callMcpToolMock).toHaveBeenCalledWith(3002, 'create_graph', {
            callerTerminalId: 'term-123',
            nodes: [
                {
                    filename: 'progress',
                    title: 'Progress',
                    summary: 'Short update',
                },
            ],
        })
    })

    it('keeps inline --node creation on the explicit live MCP-backed path', async () => {
        mocks.callMcpToolMock.mockResolvedValue({
            success: true,
            nodes: [],
        })

        await expect(
            graphCreate(3002, 'term-123', ['--node', 'Progress::Short update'])
        ).resolves.toBeUndefined()

        expect(mocks.callMcpToolMock).toHaveBeenCalledWith(3002, 'create_graph', {
            callerTerminalId: 'term-123',
            nodes: [
                {
                    filename: 'progress',
                    title: 'Progress',
                    summary: 'Short update',
                },
            ],
        })
    })
})
