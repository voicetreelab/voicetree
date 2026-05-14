// Shared helpers for CodeQL-backed health measures.
// Three runners (check-purity / check-transitive-complexity / check-semantic-coupling)
// use these to invoke `gh codeql`, parse BQRS->CSV, and atomically write reports.

import {execFileSync} from 'node:child_process'
import {existsSync, writeFileSync, mkdirSync, renameSync, unlinkSync} from 'node:fs'
import {randomBytes} from 'node:crypto'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const QLPACK_DIR = join(REPO_ROOT, 'scripts', 'codeql')
export const DB_PATH = join(REPO_ROOT, '.codeql', 'db')
export const REPORTS_DIR = join(REPO_ROOT, 'health-dashboard', 'reports')

function gh(args, opts = {}) {
    return execFileSync('gh', args, {
        cwd: QLPACK_DIR,
        encoding: 'utf8',
        stdio: opts.captureStdout ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'],
    })
}

export function ensureDatabase({rebuild = false} = {}) {
    if (existsSync(DB_PATH) && !rebuild) return
    mkdirSync(dirname(DB_PATH), {recursive: true})
    if (existsSync(DB_PATH)) execFileSync('rm', ['-rf', DB_PATH], {stdio: 'inherit'})
    gh(['codeql', 'database', 'create', DB_PATH,
        '--language=javascript',
        `--source-root=${join(REPO_ROOT, 'packages')}`,
        '--overwrite'])
}

export function runQuery(queryPath, outBqrs) {
    gh(['codeql', 'query', 'run', queryPath,
        `--database=${DB_PATH}`,
        `--output=${outBqrs}`])
}

export function decodeCsv(bqrsPath) {
    return execFileSync('gh',
        ['codeql', 'bqrs', 'decode', bqrsPath, '--format=csv'],
        {encoding: 'utf8'})
}

function parseCsvRow(line) {
    const out = []
    let i = 0
    while (i < line.length) {
        if (line[i] === '"') {
            let j = i + 1
            let value = ''
            while (j < line.length) {
                if (line[j] === '"' && line[j + 1] === '"') {value += '"'; j += 2; continue}
                if (line[j] === '"') break
                value += line[j]
                j += 1
            }
            out.push(value)
            i = j + 2
        } else {
            const end = line.indexOf(',', i)
            const stop = end < 0 ? line.length : end
            out.push(line.slice(i, stop))
            i = stop + 1
        }
    }
    return out
}

export function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(Boolean)
    if (lines.length === 0) return {header: [], rows: []}
    const header = parseCsvRow(lines[0])
    const rows = lines.slice(1).map(line => {
        const cells = parseCsvRow(line)
        return Object.fromEntries(header.map((key, i) => [key, cells[i]]))
    })
    return {header, rows}
}

function writeJsonAtomic(path, value) {
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    try {renameSync(tmp, path)}
    catch (err) {try {unlinkSync(tmp)} catch {} throw err}
}

export function writeReport(report) {
    mkdirSync(REPORTS_DIR, {recursive: true})
    writeJsonAtomic(join(REPORTS_DIR, `${report.metricId}.json`), report)
}

export function nowIso() {return new Date().toISOString()}

export function runQueryToRows(queryRelPath, bqrsTmp) {
    runQuery(queryRelPath, bqrsTmp)
    return parseCsv(decodeCsv(bqrsTmp)).rows
}
