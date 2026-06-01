// Path resolution and synchronous read helper for budget JSON files.
// All budget data lives under packages/measures/budgets/<area>/<name>.json.
// Reads synchronously at module-init time — acceptable for small config files.
import {readFileSync} from 'node:fs'
import {join, resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

export const BUDGETS_DIR: string = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'budgets')

export function readBudgetSync<T extends object>(relativePath: string): T {
    return JSON.parse(readFileSync(join(BUDGETS_DIR, relativePath), 'utf8')) as T
}
