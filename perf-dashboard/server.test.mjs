import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createPerfDashboardServer } from './server.mjs'

const reportsRoot = join(homedir(), '.voicetree', 'reports')

let server
let baseUrl
let fixtureDirs = []

function listenOnRandomPort(srv) {
  return new Promise((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      srv.off('error', reject)
      const address = srv.address()
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function closeServer(srv) {
  return new Promise((resolve, reject) => {
    srv.close(err => err ? reject(err) : resolve())
  })
}

async function createFixtureRun(ts) {
  const dir = join(reportsRoot, `stable-perf-${ts}`)
  await mkdir(join(dir, 'metrics'), { recursive: true })
  await mkdir(join(dir, 'profiles'), { recursive: true })
  await mkdir(join(dir, 'traces'), { recursive: true })
  await writeFile(join(dir, 'metrics', 'vt-graphd.metrics.ndjson'), '')
  fixtureDirs.push(dir)
  return dir
}

describe('perf-dashboard server', () => {
  beforeEach(async () => {
    server = createPerfDashboardServer()
    baseUrl = await listenOnRandomPort(server)
  })

  afterEach(async () => {
    await closeServer(server)
    await Promise.all(fixtureDirs.map(dir => rm(dir, { recursive: true, force: true })))
    fixtureDirs = []
  })

  it('rejects run file path traversal', async () => {
    const ts = `test-${Date.now()}-traversal`
    await createFixtureRun(ts)

    const relativeTraversal = await fetch(`${baseUrl}/api/runs/${ts}/file?path=${encodeURIComponent('../../etc/passwd')}`)
    assert.notEqual(relativeTraversal.status, 200)
    assert.ok(relativeTraversal.status >= 400 && relativeTraversal.status < 500)

    const absoluteTraversal = await fetch(`${baseUrl}/api/runs/${ts}/file?path=${encodeURIComponent('/etc/passwd')}`)
    assert.notEqual(absoluteTraversal.status, 200)
    assert.ok(absoluteTraversal.status >= 400 && absoluteTraversal.status < 500)
  })

  it('returns the MVP manifest shape for a synthetic run', async () => {
    const ts = `test-${Date.now()}-manifest`
    await createFixtureRun(ts)

    const res = await fetch(`${baseUrl}/api/runs/${ts}/manifest`)
    assert.equal(res.status, 200)
    const manifest = await res.json()

    assert.deepEqual(Object.keys(manifest).sort(), [
      'duration_ms',
      'metrics',
      'profiles',
      'services',
      'traces',
      'ts',
    ])
    assert.equal(manifest.ts, ts)
    assert.deepEqual(manifest.services, ['vt-graphd'])
    assert.deepEqual(manifest.metrics, {
      'vt-graphd': 'metrics/vt-graphd.metrics.ndjson',
    })
    assert.deepEqual(manifest.profiles, {})
    assert.deepEqual(manifest.traces, {})
  })
})
