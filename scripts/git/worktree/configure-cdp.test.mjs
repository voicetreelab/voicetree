import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(__dirname, 'configure-cdp.sh')

/**
 * Create a real git-worktree-shaped layout. Sibling layout:
 *   <parent>/vtrepo/                   (initialised git repo with one commit)
 *     .mcp.json                       (template — copied by the script)
 *   <parent>/vt-wts/<wtName>/          (linked git worktree)
 *     webapp/                         (needed for .cdp-port write)
 *
 * configure-cdp.sh resolves the main repo via `git worktree list --porcelain`,
 * so we need a real git repo (not just a fake directory) to test it end-to-end.
 */
function makeRepo({mcpJsonTemplate}) {
  const parent = mkdtempSync(join(tmpdir(), 'vt-configure-cdp-'))
  const repoRoot = join(parent, 'vtrepo')
  mkdirSync(repoRoot, {recursive: true})

  spawnSync('git', ['init', '-q', '-b', 'main'], {cwd: repoRoot})
  spawnSync('git', ['config', 'user.email', 'test@example.com'], {cwd: repoRoot})
  spawnSync('git', ['config', 'user.name', 'Test'], {cwd: repoRoot})
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], {cwd: repoRoot})
  writeFileSync(join(repoRoot, '.mcp.json'), mcpJsonTemplate, 'utf-8')
  spawnSync('git', ['add', '.mcp.json'], {cwd: repoRoot})
  spawnSync('git', ['commit', '-q', '-m', 'seed'], {cwd: repoRoot})

  const wtName = 'wt-sample'
  const wtPath = join(parent, 'vt-wts', wtName)
  spawnSync('git', ['worktree', 'add', '-b', wtName, wtPath], {cwd: repoRoot})
  mkdirSync(join(wtPath, 'webapp'), {recursive: true})

  return {
    repoRoot,
    wtName,
    wtPath,
    cdpPortPath: join(wtPath, 'webapp', '.cdp-port'),
    mcpJsonPath: join(wtPath, '.mcp.json'),
  }
}

function runScript(wtPath, wtName, env = {}) {
  const result = spawnSync('sh', [SCRIPT, wtPath, wtName], {
    env: {...process.env, ...env},
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    throw new Error(
      `configure-cdp.sh exited ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    )
  }
  return result
}

test('writes a free CDP port to webapp/.cdp-port and patches the Playwright endpoint in .mcp.json', () => {
  // Template already carries a localhost CDP endpoint so both the jq path
  // (rewrites the whole args array) and the sed fallback (substitutes the
  // existing http://localhost:* token) converge on the selected port.
  const tpl = JSON.stringify(
    {
      mcpServers: {
        playwright: {
          type: 'stdio',
          command: 'npx',
          args: ['@playwright/mcp@latest', '--cdp-endpoint', 'http://localhost:1'],
        },
      },
    },
    null,
    2,
  )
  const fixture = makeRepo({mcpJsonTemplate: tpl})

  runScript(fixture.wtPath, fixture.wtName)

  const cdpPort = readFileSync(fixture.cdpPortPath, 'utf-8').trim()
  assert.match(cdpPort, /^\d+$/, 'a numeric CDP port is written to .cdp-port')
  const portNum = Number(cdpPort)
  assert.ok(portNum >= 9222 && portNum <= 9322, `CDP port ${portNum} within range 9222-9322`)

  const mcp = readFileSync(fixture.mcpJsonPath, 'utf-8')
  assert.match(
    mcp,
    new RegExp(`http://localhost:${cdpPort}\\b`),
    'Playwright CDP endpoint patched to the selected port',
  )
})

test('still selects a CDP port and exits 0 without patching .mcp.json when the repo has no template', () => {
  // The CDP port is allocated before the template check, so it is written even
  // when the repo has no .mcp.json to copy. The worktree's committed .mcp.json
  // is then left untouched (no Playwright endpoint patch).
  const fixture = makeRepo({mcpJsonTemplate: '{}'})
  unlinkSync(join(fixture.repoRoot, '.mcp.json'))

  const result = spawnSync('sh', [SCRIPT, fixture.wtPath, fixture.wtName], {
    env: process.env,
    encoding: 'utf-8',
  })
  assert.equal(result.status, 0, `script should still succeed; stderr:\n${result.stderr}`)

  const cdpPort = readFileSync(fixture.cdpPortPath, 'utf-8').trim()
  assert.match(cdpPort, /^\d+$/, '.cdp-port is written even without an .mcp.json template')

  const mcp = readFileSync(fixture.mcpJsonPath, 'utf-8')
  assert.doesNotMatch(mcp, /cdp-endpoint/, 'no Playwright patch is applied when the template is missing')
})
