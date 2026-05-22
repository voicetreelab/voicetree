import {readdir} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_DIR, '../../../../..')
const SCRIPTS_DIR: string = resolve(REPO_ROOT, 'scripts')
const FORBIDDEN_SCRIPT_NAME_PATTERN = /^(?:check|measure)-.*\.mjs$/

async function collectScriptFiles(absDir: string): Promise<string[]> {
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
        entries = await readdir(absDir, {withFileTypes: true})
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }

    const files = await Promise.all(entries.map(async entry => {
        const absPath = join(absDir, entry.name)
        if (entry.isDirectory()) return collectScriptFiles(absPath)
        if (!entry.isFile()) return []
        return [relative(REPO_ROOT, absPath)]
    }))

    return files.flat().sort()
}

describe('script naming guard', () => {
    it('keeps migrated check and measure script names out of scripts', async () => {
        const violations = (await collectScriptFiles(SCRIPTS_DIR))
            .filter(file => FORBIDDEN_SCRIPT_NAME_PATTERN.test(file.split('/').at(-1) ?? ''))

        await recordHealthMetric({
            metricId: 'script-naming-guard',
            metricName: 'Script Naming Guard',
            description: 'Detects forbidden scripts/check-*.mjs or scripts/measure-*.mjs files after migration.',
            category: 'Other',
            current: violations.length,
            budget: 0,
            comparison: 'lte',
            unit: 'files',
            details: {violations},
        })

        expect(violations, `Forbidden script names:\n${violations.map(v => `  ${v}`).join('\n')}`).toEqual([])
    })
})
