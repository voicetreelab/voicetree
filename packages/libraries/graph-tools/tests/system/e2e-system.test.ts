import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../../../../..')
const HEADLESS_START_TIMEOUT_MS = 15_000

function runCli(args: readonly string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'packages/libraries/graph-tools/bin/vt-graph.ts', ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: env ? {...process.env, ...env} : process.env,
    },
  )
}

function makeVault(tempDirs: string[]): string {
  const project = mkdtempSync(path.join(tmpdir(), 'vt-tools-system-'))
  tempDirs.push(project)
  mkdirSync(path.join(project, '.voicetree'))
  mkdirSync(path.join(project, 'work'))
  writeFileSync(path.join(project, 'index.md'), '# Index\n\n[[work/task]]\n')
  writeFileSync(path.join(project, 'work', 'task.md'), '# Task\n\n[[index]]\n')
  return project
}

interface HeadlessHandle {
  readonly url: string
  readonly projectPath: string
  close(): Promise<void>
}

async function startHeadless(project: string): Promise<HeadlessHandle> {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'packages/libraries/graph-tools/bin/vt-headless.ts',
      'serve',
      '--project',
      project,
      '--port',
      '0',
    ],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGINT')
      reject(new Error(`vt-headless did not announce a URL. stdout=${stdout} stderr=${stderr}`))
    }, HEADLESS_START_TIMEOUT_MS)
    child.stdout.on('data', () => {
      const match = stdout.match(/Listening on (http:\/\/\S+)/)
      if (!match) return
      clearTimeout(timeout)
      resolve(match[1].trim())
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`vt-headless exited early with ${code}. stdout=${stdout} stderr=${stderr}`))
    })
  })

  return {
    url,
    projectPath: project,
    close: async () => {
      if (child.exitCode !== null) return
      child.kill('SIGINT')
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    },
  }
}

describe('@vt/graph-tools system contract', () => {
  const tempDirs: string[] = []
  let project: string

  beforeEach(() => {
    project = makeVault(tempDirs)
  })

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('static CLI', () => {
    it('state dump returns the project graph as JSON', () => {
      const result = runCli(['state', 'dump', project])
      expect(result.status).toBe(0)
      const state = JSON.parse(result.stdout) as { graph: { nodes: Record<string, unknown> } }
      expect(Object.keys(state.graph.nodes)).toHaveLength(2)
    })

    it('structure --ascii prints node titles', () => {
      const result = runCli(['structure', project, '--ascii', '--no-auto'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('index')
      expect(result.stdout).toContain('task')
    })

    it('lint --json reports zero violations for a clean project', () => {
      const result = runCli(['lint', project, '--json'])
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

    function daemonEnv(server: HeadlessHandle): NodeJS.ProcessEnv {
      return {
        VOICETREE_DAEMON_URL: server.url,
        VOICETREE_PROJECT_PATH: server.projectPath,
      }
    }

    it('live state dump returns the snapshot via HTTP', { timeout: 30_000 }, async () => {
      const server = await startHeadless(project)
      servers.push(server)

      const result = runCli(['live', 'state', 'dump'], daemonEnv(server))
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).folderState).toEqual([[project, 'expanded']])
    })

    it('live apply SetFolderState mutates session state', { timeout: 30_000 }, async () => {
      const server = await startHeadless(project)
      servers.push(server)
      const collapseFolder = `${project}/work/`

      const result = runCli([
        'live',
        'apply',
        JSON.stringify({
          type: 'SetFolderState',
          viewId: 'main',
          path: collapseFolder.slice(0, -1),
          state: 'collapsed',
        }),
      ], daemonEnv(server))
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        collapseAdded: [collapseFolder],
      })
    })

    it('live view prints node titles', { timeout: 30_000 }, async () => {
      const server = await startHeadless(project)
      servers.push(server)

      const result = runCli(['live', 'view'], daemonEnv(server))
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('index')
    })
  })
})
