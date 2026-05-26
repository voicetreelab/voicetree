#!/usr/bin/env node
import {readFile} from 'node:fs/promises'
import {dirname, resolve as resolvePath} from 'node:path'
import {fileURLToPath} from 'node:url'

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FILE_A = 'CLAUDE.md'
const FILE_B = 'AGENTS.md'

const [bytesA, bytesB] = await Promise.all([
    readFile(resolvePath(REPO_ROOT, FILE_A)),
    readFile(resolvePath(REPO_ROOT, FILE_B)),
])

if (bytesA.equals(bytesB)) {
    process.exit(0)
}

console.error(`${FILE_A} and ${FILE_B} differ. They must be byte-identical.`)
console.error(`Reconcile them (e.g. \`cp ${FILE_A} ${FILE_B}\`), commit, then re-run.`)
console.error(`  ${FILE_A}: ${bytesA.length} bytes`)
console.error(`  ${FILE_B}: ${bytesB.length} bytes`)
process.exit(1)
