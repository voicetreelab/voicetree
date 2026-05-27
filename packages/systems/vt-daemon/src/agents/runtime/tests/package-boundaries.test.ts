import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT: string = resolve(TEST_FILE_DIR, '../../..')
const REPO_ROOT: string = resolve(PACKAGE_ROOT, '../..')

type Violation = {
    file: string
    line: number
    rule: string
    snippet: string
}

const FORBIDDEN_RULES: readonly {rule: string, pattern: RegExp}[] = [
    {
        rule: "No 'electron' or main-process globals (BrowserWindow / ipcMain / webContents)",
        pattern: /from\s+['"]electron['"]|\bBrowserWindow\b|\bipcMain\b|\bwebContents\b/,
    },
    {
        rule: "No '@/shell/edge/...' webapp-internal paths",
        pattern: /from\s+['"]@\/shell\/edge\//,
    },
    {
        rule: "No 'uiAPI' references (renderer surface) — keep vt-daemon agent runtime UI-agnostic",
        pattern: /\buiAPI\b/,
    },
    {
        rule: "No deep 'webapp/src/...' imports — depend on packages or accept callbacks",
        pattern: /from\s+['"]webapp\/src\//,
    },
    {
        rule: "No '@vt/graph-db-server' imports in production sources",
        pattern: /from\s+['"]@vt\/graph-db-server(?:\/[^'"]*)?['"]/,
    },
] as const

async function pathExists(p: string): Promise<boolean> {
    try {
        await stat(p)
        return true
    } catch {
        return false
    }
}

function isProductionSource(path: string): boolean {
    return !path.endsWith('.test.ts')
        && !path.endsWith('.test.tsx')
        && !path.endsWith('.spec.ts')
        && !path.endsWith('.spec.tsx')
        && !path.includes('/__tests__/')
}

async function listProductionSources(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) {
            return listProductionSources(path)
        }
        if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && isProductionSource(path)) {
            return [path]
        }
        return []
    }))
    return nested.flat()
}

async function findViolations(): Promise<Violation[]> {
    const sourceFiles = await listProductionSources(join(PACKAGE_ROOT, 'src'))
    const violations: Violation[] = []

    for (const file of sourceFiles) {
        const text = await readFile(file, 'utf8')
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i]!
            for (const {rule, pattern} of FORBIDDEN_RULES) {
                if (pattern.test(line)) {
                    violations.push({
                        file: relative(REPO_ROOT, file),
                        line: i + 1,
                        rule,
                        snippet: line.trim(),
                    })
                }
            }
        }
    }

    return violations
}

function formatViolation(v: Violation): string {
    return `${v.file}:${v.line} — ${v.rule}\n    ${v.snippet}`
}

describe('@vt/vt-daemon agent runtime package boundaries', () => {
    it('forbids electron / webapp-edge / uiAPI / deep webapp / graph-db-server imports in production sources', async () => {
        const violations = await findViolations()
        expect(violations.map(formatViolation)).toEqual([])
    })
})
