#!/usr/bin/env node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { startDaemon } from '@vt/graph-db-server/server'

const DEFAULT_RUNS = 5
const DEFAULT_DELAY_MS = 500

function parseArgs(argv) {
  const config = {
    runs: DEFAULT_RUNS,
    delayMs: DEFAULT_DELAY_MS,
    json: false,
  }

  for (const arg of argv) {
    if (arg === '--') continue
    if (arg === '--json') {
      config.json = true
      continue
    }
    if (arg.startsWith('--runs=')) {
      config.runs = Number(arg.slice('--runs='.length))
      continue
    }
    if (arg.startsWith('--delay-ms=')) {
      config.delayMs = Number(arg.slice('--delay-ms='.length))
      continue
    }
    if (arg === '--help' || arg === '-h') {
      config.help = true
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }

  if (!Number.isInteger(config.runs) || config.runs < 1) throw new Error('--runs must be a positive integer')
  if (!Number.isFinite(config.delayMs) || config.delayMs < 0) throw new Error('--delay-ms must be a non-negative number')
  return config
}

function usage() {
  return `Usage:
  pnpm perf:project-open-broadcast -- --delay-ms=500 --runs=5

Starts a real graphd with an injected slow folder-tree scanner and measures HTTP /project/open latency.`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarize(timings) {
  const sorted = [...timings].sort((a, b) => a - b)
  return {
    minMs: sorted[0],
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1],
  }
}

function round(value) {
  return Math.round(value * 10) / 10
}

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), 'vt-project-open-bench-'))
  const writeFolderPath = join(root, 'voicetree-bench')
  const voicetreeHomePath = await mkdtemp(join(tmpdir(), 'vt-project-open-bench-home-'))
  await mkdir(writeFolderPath, { recursive: true })
  await writeFile(join(writeFolderPath, 'bench.md'), '# bench\n')
  await writeFile(join(voicetreeHomePath, 'voicetree-config.json'), JSON.stringify({
    projectConfig: {
      [root]: { writeFolderPath },
    },
  }))
  return { root, writeFolderPath, voicetreeHomePath }
}

async function measureOnce(delayMs) {
  const project = await createProject()
  let scannerCalls = 0
  const scanner = async (rootPath) => {
    scannerCalls += 1
    await sleep(delayMs)
    return {
      absolutePath: rootPath,
      name: rootPath.split('/').at(-1) || rootPath,
      isDirectory: true,
      children: [],
    }
  }
  const handle = await startDaemon({
    voicetreeHomePath: project.voicetreeHomePath,
    createStarterIfEmpty: false,
    folderTreeScanner: scanner,
    logger: { error() {}, writeStderr() {} },
  })

  try {
    const start = performance.now()
    const response = await fetch(`http://127.0.0.1:${handle.port}/project/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: project.root,
        writeFolderPath: project.writeFolderPath,
      }),
    })
    const elapsedMs = performance.now() - start
    if (!response.ok) {
      throw new Error(`open failed: ${response.status} ${await response.text()}`)
    }
    return { elapsedMs, scannerCalls }
  } finally {
    await handle.stop().catch(() => {})
    await rm(project.root, { recursive: true, force: true })
    await rm(project.voicetreeHomePath, { recursive: true, force: true })
  }
}

async function run(config) {
  const rows = []
  for (let i = 0; i < config.runs; i += 1) {
    rows.push(await measureOnce(config.delayMs))
  }
  return {
    runs: config.runs,
    delayMs: config.delayMs,
    scannerCalls: rows.map((row) => row.scannerCalls),
    ...summarize(rows.map((row) => row.elapsedMs)),
  }
}

function renderText(result) {
  return [
    'project-open-broadcast bench',
    `runs=${result.runs}`,
    `injectedScannerDelay=${result.delayMs}ms`,
    `median=${round(result.medianMs)}ms`,
    `p95=${round(result.p95Ms)}ms`,
    `min=${round(result.minMs)}ms`,
    `max=${round(result.maxMs)}ms`,
    `scannerCalls=${result.scannerCalls.join(',')}`,
  ].join(' ')
}

async function main() {
  const config = parseArgs(process.argv.slice(2))
  if (config.help) {
    console.log(usage())
    return
  }
  const result = await run(config)
  console.log(config.json ? JSON.stringify(result, null, 2) : renderText(result))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  console.error(usage())
  process.exit(1)
})
