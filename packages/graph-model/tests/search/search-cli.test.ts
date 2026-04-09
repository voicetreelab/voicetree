import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
    graphIndexMock: vi.fn(),
    graphSearchMock: vi.fn(),
    outputMock: vi.fn(),
    errorMock: vi.fn((message: string): never => {
        throw new Error(message)
    }),
}))

vi.mock('../../../../webapp/src/shell/edge/main/cli/commands/graph.ts', () => ({
    graphCreate: vi.fn(),
    graphUnseen: vi.fn(),
    graphStructure: vi.fn(),
    graphLintCommand: vi.fn(),
    graphSearch: mocks.graphSearchMock,
    graphIndex: mocks.graphIndexMock,
}))

vi.mock('../../../../webapp/src/shell/edge/main/cli/output.ts', () => ({
    error: mocks.errorMock,
    output: mocks.outputMock,
    isJsonMode: () => false,
}))

import {main} from '../../../../webapp/src/shell/edge/main/cli/voicetree-cli.ts'

describe('vt graph index/search integration', () => {
    const expectedTerminalId: string | undefined = process.env.VOICETREE_TERMINAL_ID

    beforeEach(() => {
        mocks.graphIndexMock.mockReset()
        mocks.graphSearchMock.mockReset()
        mocks.outputMock.mockReset()
        mocks.errorMock.mockReset()
    })

    it('routes graph index to dedicated graphIndex handler', async () => {
        const vaultPath = '/tmp/vault-1'

        mocks.graphIndexMock.mockResolvedValue(undefined)
        await expect(main(['graph', 'index', vaultPath])).resolves.toBeUndefined()

        expect(mocks.graphIndexMock).toHaveBeenCalledWith(3002, expectedTerminalId, [vaultPath])
        expect(mocks.outputMock).not.toHaveBeenCalled()
    })

    it('routes graph search arguments to dedicated graphSearch handler', async () => {
        const vaultPath = '/tmp/vault-2'
        const query = ['what', 'is', 'looping']

        mocks.graphSearchMock.mockResolvedValue(undefined)
        await expect(main(['graph', 'search', vaultPath, ...query])).resolves.toBeUndefined()

        expect(mocks.graphSearchMock).toHaveBeenCalledWith(3002, expectedTerminalId, [vaultPath, ...query])
        expect(mocks.outputMock).not.toHaveBeenCalled()
    })
})
