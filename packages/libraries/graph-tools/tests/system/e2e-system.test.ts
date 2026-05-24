import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../../../../..')
const HEADLESS_START_TIMEOUT_MS = 15_000

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
      '--project-root',
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
  let vault: string

  beforeEach(() => {
    vault = makeVault(tempDirs)
  })

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('static CLI', () => {
    it('state dump returns the vault graph as JSON', () => {
      const result = runCli(['state', 'dump', vault])
      expect(result.status).toBe(0)
      const state = JSON.parse(result.stdout) as { graph: { nodes: Record<string, unknown> } }
      expect(Object.keys(state.graph.nodes)).toHaveLength(2)
    })

    it('structure --ascii prints node titles', () => {
      const result = runCli(['structure', vault, '--ascii', '--no-auto'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('index')
      expect(result.stdout).toContain('task')
    })

    it('lint --json reports zero violations for a clean vault', () => {
      const result = runCli(['lint', vault, '--json'])
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        summary: {
          violationCount: 0,
          warningCount: 0,
        },
      })
    })
  })

  describe('live transport (vt-headless)', () => {
    const servers: Array<{ close(): Promise<void> }> = []

    afterEach(async () => {
      await Promise.all(servers.splice(0).map((server) => server.close()))
    })

    it('live state dump returns the snapshot via HTTP', { timeout: 30_000 }, async () => {
      const server = await startHeadless(vault)
      servers.push(server)

      const result = runCli(['live', 'state', 'dump', '--port', String(server.port)])
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).folderState).toEqual([[vault, 'expanded']])
    })

    it('live apply SetFolderState mutates session state', { timeout: 30_000 }, async () => {
      const server = await startHeadless(vault)
      servers.push(server)
      const collapseFolder = `${vault}/work/`

      const result = runCli([
        'live',
        'apply',
        JSON.stringify({
          type: 'SetFolderState',
          viewId: 'main',
          path: collapseFolder.slice(0, -1),
          state: 'collapsed',
        }),
        '--port',
        String(server.port),
      ])
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        collapseAdded: [collapseFolder],
      })
    })

    it('live view prints node titles', { timeout: 30_000 }, async () => {
      const server = await startHeadless(vault)
      servers.push(server)

      const result = runCli(['live', 'view', '--port', String(server.port)])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('index')
    })
  })
})
