import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {describe, expect, it} from 'vitest'

import {spawnCheck} from './capture-check-runner.ts'

const describePosix = process.platform === 'win32' ? describe.skip : describe

describePosix('spawnCheck timeout handling', () => {
    it('terminates descendant processes that inherit check stdio', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'capture-check-runner-'))
        const childPath = join(repoRoot, 'child.mjs')
        const parentPath = join(repoRoot, 'parent.mjs')

        await writeFile(childPath, [
            'setInterval(() => {',
            "  process.stdout.write('child still running\\n')",
            '}, 50)',
            '',
        ].join('\n'))
        await writeFile(parentPath, [
            "import {spawn} from 'node:child_process'",
            `spawn(process.execPath, [${JSON.stringify(childPath)}], {stdio: ['ignore', 'inherit', 'inherit']})`,
            'setInterval(() => {',
            "  process.stdout.write('parent still running\\n')",
            '}, 50)',
            '',
        ].join('\n'))

        try {
            const outcome = await spawnCheck({
                id: 'timeout-with-descendant',
                name: 'timeout with descendant',
                category: 'Other',
                display: 'node parent.mjs',
                args: () => [process.execPath, parentPath],
                parser: 'none',
                timeoutMs: 250,
            }, process.env, repoRoot)

            expect(outcome.status).toBe('fail')
            expect(outcome.timedOut).toBe(true)
            expect(outcome.durationMs).toBeLessThan(3_000)
        } finally {
            await rm(repoRoot, {recursive: true, force: true})
        }
    }, 4_000)
})
