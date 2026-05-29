import {mkdtemp, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

import {readRpcPortFile, rpcPortFilePath, writeRpcPortFile} from '../src/portFile.ts'

describe('rpc.port file', (): void => {
    it('round-trips via atomic write', async (): Promise<void> => {
        const project: string = await mkdtemp(join(tmpdir(), 'vt-rpc-port-'))
        await writeRpcPortFile(project, 12345)
        const raw: string = await readFile(rpcPortFilePath(project), 'utf8')
        expect(raw).toBe('12345\n')
        expect(await readRpcPortFile(project)).toBe(12345)
    })

    it('overwrites a prior file atomically (idempotent on restart)', async (): Promise<void> => {
        const project: string = await mkdtemp(join(tmpdir(), 'vt-rpc-port-'))
        await writeRpcPortFile(project, 11111)
        await writeRpcPortFile(project, 22222)
        expect(await readRpcPortFile(project)).toBe(22222)
    })

    it('rejects an invalid port (out of TCP range)', async (): Promise<void> => {
        const project: string = await mkdtemp(join(tmpdir(), 'vt-rpc-port-'))
        await expect(writeRpcPortFile(project, 0)).rejects.toThrow(/invalid port/)
        await expect(writeRpcPortFile(project, 65536)).rejects.toThrow(/invalid port/)
    })

    it('readRpcPortFile returns null when missing', async (): Promise<void> => {
        const project: string = await mkdtemp(join(tmpdir(), 'vt-rpc-port-'))
        expect(await readRpcPortFile(project)).toBe(null)
    })
})
