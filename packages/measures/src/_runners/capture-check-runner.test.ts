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

    it('summarizes failed Playwright specs from the JSON report', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'capture-check-runner-playwright-'))
        const checkPath = join(repoRoot, 'fake-playwright.mjs')

        await writeFile(checkPath, [
            'import {writeFileSync} from "node:fs"',
            'const report = {',
            '  stats: {expected: 1, unexpected: 1, skipped: 1, flaky: 0},',
            '  suites: [{',
            '    title: "project-selection.spec.ts",',
            '    suites: [{',
            '      title: "Project Selection",',
            '      specs: [{',
            '        title: "opens saved project",',
            '        ok: false,',
            '        file: "project-selection.spec.ts",',
            '        tests: [{results: [{status: "failed", errors: [{message: "Expected project button to be visible"}]}]}]',
            '      }]',
            '    }]',
            '  }]',
            '}',
            'writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(report))',
            'process.exit(1)',
            '',
        ].join('\n'))

        try {
            const outcome = await spawnCheck({
                id: 'playwright-failure-summary',
                name: 'playwright failure summary',
                category: 'E2E',
                display: 'node fake-playwright.mjs',
                args: () => [process.execPath, checkPath],
                parser: 'playwright',
                timeoutMs: 2_000,
            }, process.env, repoRoot)

            expect(outcome.status).toBe('fail')
            expect(outcome.testsTotal).toBe(3)
            expect(outcome.testsFailed).toBe(1)
            expect(outcome.failureDetails.failedTests).toEqual([{
                fullName: 'project-selection.spec.ts > Project Selection > opens saved project',
                fileName: 'project-selection.spec.ts',
                message: 'Expected project button to be visible',
            }])
        } finally {
            await rm(repoRoot, {recursive: true, force: true})
        }
    })
})
