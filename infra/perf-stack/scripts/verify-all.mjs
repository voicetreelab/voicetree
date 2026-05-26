#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SIGNALS = ['logs', 'metrics', 'traces', 'profiles']

const exists = async (path) => access(path).then(() => true, () => false)

const runScript = async (signal) => {
  const path = join(SCRIPT_DIR, `verify-${signal}.mjs`)
  if (!(await exists(path))) return { signal, ok: false, detail: 'missing verify script' }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path], { stdio: 'inherit' })
    child.on('exit', (code) => resolve({ signal, ok: code === 0, detail: `exit ${code}` }))
  })
}

const results = await Promise.all(SIGNALS.map(runScript))

console.log('signal     status  detail')
for (const result of results) {
  console.log(`${result.signal.padEnd(10)} ${result.ok ? 'ok'.padEnd(7) : 'fail'.padEnd(7)} ${result.detail}`)
}

process.exit(results.every((result) => result.ok) ? 0 : 1)
