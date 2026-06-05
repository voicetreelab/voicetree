#!/usr/bin/env node

import { performance } from 'node:perf_hooks'
import { getDirectoryTree } from '@vt/graph-db-server/graph/folderScanner'

const DEFAULT_ROOT = process.cwd()
const DEFAULT_DEPTHS = [10, 3, 2, 1]
const DEFAULT_RUNS = 5

function parseArgs(argv) {
  const config = {
    root: DEFAULT_ROOT,
    depths: DEFAULT_DEPTHS,
    runs: DEFAULT_RUNS,
    json: false,
  }

  for (const arg of argv) {
    if (arg === '--') continue
    if (arg === '--json') {
      config.json = true
      continue
    }
    if (arg.startsWith('--root=')) {
      config.root = arg.slice('--root='.length)
      continue
    }
    if (arg.startsWith('--depths=')) {
      config.depths = arg
        .slice('--depths='.length)
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value >= 0)
      continue
    }
    if (arg.startsWith('--runs=')) {
      config.runs = Number(arg.slice('--runs='.length))
      continue
    }
    if (arg === '--help' || arg === '-h') {
      config.help = true
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }

  if (config.depths.length === 0) throw new Error('--depths must include at least one non-negative integer')
  if (!Number.isInteger(config.runs) || config.runs < 1) throw new Error('--runs must be a positive integer')

  return config
}

function usage() {
  return `Usage:
  pnpm perf:folder-tree-open -- --root=/Users/bobbobby/repos --depths=10,3,2 --runs=5

Measures the production folder-tree scanner used by project-open sidebar broadcast.`
}

function countEntries(entry) {
  let directories = entry.isDirectory ? 1 : 0
  let files = entry.isDirectory ? 0 : 1
  for (const child of entry.children ?? []) {
    const childCounts = countEntries(child)
    directories += childCounts.directories
    files += childCounts.files
  }
  return { directories, files, total: directories + files }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

async function measureDepth(root, depth, runs) {
  const timings = []
  let counts = null

  for (let i = 0; i < runs; i += 1) {
    const start = performance.now()
    const tree = await getDirectoryTree(root, depth)
    const elapsedMs = performance.now() - start
    timings.push(elapsedMs)
    counts = countEntries(tree)
  }

  const sorted = [...timings].sort((a, b) => a - b)
  return {
    depth,
    runs,
    minMs: sorted[0],
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1],
    counts,
  }
}

function round(value) {
  return Math.round(value * 10) / 10
}

function renderText(root, results) {
  const lines = [`folder-tree-open bench root=${root}`]
  for (const result of results) {
    lines.push(
      [
        `depth=${result.depth}`,
        `runs=${result.runs}`,
        `median=${round(result.medianMs)}ms`,
        `p95=${round(result.p95Ms)}ms`,
        `min=${round(result.minMs)}ms`,
        `max=${round(result.maxMs)}ms`,
        `dirs=${result.counts.directories}`,
        `files=${result.counts.files}`,
      ].join(' '),
    )
  }
  return lines.join('\n')
}

async function main() {
  const config = parseArgs(process.argv.slice(2))
  if (config.help) {
    console.log(usage())
    return
  }

  const results = []
  for (const depth of config.depths) {
    results.push(await measureDepth(config.root, depth, config.runs))
  }

  if (config.json) {
    console.log(JSON.stringify({ root: config.root, results }, null, 2))
    return
  }
  console.log(renderText(config.root, results))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  console.error(usage())
  process.exit(1)
})
