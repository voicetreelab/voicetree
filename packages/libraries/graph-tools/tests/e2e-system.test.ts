import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../../../..')
const HEADLESS_START_TIMEOUT_MS = 15_000
const SYSTEM_CONTRACT_TIMEOUT_MS = 30_000

function runCli(args: readonly string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'packages/libraries/graph-tools/bin/vt-graph.ts', ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  )
}

function makeVault(tempDirs: string[]): string {
  const vault = mkdtempSync(path.join(tmpdir(), 'vt-tools-system-'))
  tempDirs.push(vault)
  mkdirSync(path.join(vault, 'work'))
  writeFileSync(path.join(vault, 'index.md'), '# Index\n\n[[work/task]]\n')
  writeFileSync(path.join(vault, 'work', 'task.md'), '# Task\n\n[[index]]\n')
  return vault
}

async function startHeadless(vault: string): Promise<{
  close(): Promise<void>
  port: number
}> {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'packages/libraries/graph-tools/bin/vt-headless.ts',
      'serve',
      '--port',
      '0',
      '--vault',
      vault,
    ],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGINT')
      reject(new Error(`vt-headless did not print a port. stdout=${stdout} stderr=${stderr}`))
    }, HEADLESS_START_TIMEOUT_MS)
    child.stdout.on('data', () => {
      const match = stdout.match(/Listening on port (\d+)/)
      if (!match) return
      clearTimeout(timeout)
      resolve(Number.parseInt(match[1], 10))
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`vt-headless exited early with ${code}. stdout=${stdout} stderr=${stderr}`))
    })
  })

  return {
    port,
    close: async () => {
      if (child.exitCode !== null) return
      child.kill('SIGINT')
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    },
  }
}

describe('@vt/graph-tools system contract', () => {
  const tempDirs: string[] = []
  const servers: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()))
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drives the vault CLI and headless live transport as an external user would', async () => {
    const vault = makeVault(tempDirs)

    const dump = runCli(['state', 'dump', vault])
    expect(dump.status).toBe(0)
    const state = JSON.parse(dump.stdout) as { graph: { nodes: Record<string, unknown> } }
    expect(Object.keys(state.graph.nodes)).toHaveLength(2)

    const view = runCli(['structure', vault, '--ascii', '--no-auto'])
    expect(view.status).toBe(0)
    expect(view.stdout).toContain('Index')
    expect(view.stdout).toContain('Task')

    const lint = runCli(['lint', vault, '--json'])
    expect(lint.status).toBe(0)
    expect(JSON.parse(lint.stdout)).toMatchObject({
      summary: {
        violationCount: 0,
        warningCount: 0,
      },
    })

    const server = await startHeadless(vault)
    servers.push(server)

    const liveDump = runCli(['live', 'state', 'dump', '--port', String(server.port)])
    expect(liveDump.status).toBe(0)
    expect(JSON.parse(liveDump.stdout).roots.loaded).toEqual([vault])

    const collapseFolder = `${vault}/work/`
    const liveApply = runCli([
      'live',
      'apply',
      JSON.stringify({ type: 'Collapse', folder: collapseFolder }),
      '--port',
      String(server.port),
    ])
    expect(liveApply.status).toBe(0)
    expect(JSON.parse(liveApply.stdout)).toMatchObject({
      collapseAdded: [collapseFolder],
    })

    const liveView = runCli(['live', 'view', '--port', String(server.port)])
    expect(liveView.status).toBe(0)
    expect(liveView.stdout).toContain('Index')
  }, SYSTEM_CONTRACT_TIMEOUT_MS)
})
