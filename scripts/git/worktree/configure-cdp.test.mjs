import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
 * Create a fake repo layout:
 *   <repoRoot>/
 *     .mcp.json                       (template — copied by the script)
 *     .worktrees/<wtName>/
 *       webapp/                       (needed for .cdp-port write)
 * Returns paths used by assertions.
 */
function makeRepo({mcpJsonTemplate}) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'vt-configure-cdp-'))
  const wtName = 'wt-sample'
  const wtPath = join(repoRoot, '.worktrees', wtName)
  mkdirSync(join(wtPath, 'webapp'), {recursive: true})
  writeFileSync(join(repoRoot, '.mcp.json'), mcpJsonTemplate, 'utf-8')
  return {
    repoRoot,
    wtName,
    wtPath,
    mcpJsonPath: join(wtPath, '.mcp.json'),
    codexCfgPath: join(wtPath, '.codex', 'config.toml'),
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

test('writes voicetree URL into .codex/config.toml when VOICETREE_MCP_PORT is set', () => {
  const tpl = JSON.stringify({mcpServers: {voicetree: {type: 'http', url: 'http://127.0.0.1:9999/mcp'}}}, null, 2)
  const fixture = makeRepo({mcpJsonTemplate: tpl})

  runScript(fixture.wtPath, fixture.wtName, {VOICETREE_MCP_PORT: '4242'})

  const codex = readFileSync(fixture.codexCfgPath, 'utf-8')
  assert.match(codex, /\[mcp_servers\.voicetree\]/)
  assert.match(codex, /url\s*=\s*"http:\/\/localhost:4242\/mcp"/)
})

test('updates an existing stale voicetree section in .codex/config.toml (preserves other sections)', () => {
  const tpl = JSON.stringify({mcpServers: {voicetree: {type: 'http', url: 'http://127.0.0.1:9999/mcp'}}}, null, 2)
  const fixture = makeRepo({mcpJsonTemplate: tpl})

  mkdirSync(join(fixture.wtPath, '.codex'), {recursive: true})
  writeFileSync(
    fixture.codexCfgPath,
    '[other]\nkey = "value"\n\n[mcp_servers.voicetree]\nurl = "http://localhost:9999/mcp"\n',
    'utf-8',
  )

  runScript(fixture.wtPath, fixture.wtName, {VOICETREE_MCP_PORT: '4242'})

  const codex = readFileSync(fixture.codexCfgPath, 'utf-8')
  assert.match(codex, /\[other\]\s*\nkey = "value"/, 'other section preserved')
  assert.match(codex, /url\s*=\s*"http:\/\/localhost:4242\/mcp"/, 'voicetree url updated')
  assert.doesNotMatch(codex, /9999/, 'stale port gone')
})

test('appends voicetree section when .codex/config.toml has unrelated content only', () => {
  const tpl = JSON.stringify({mcpServers: {voicetree: {type: 'http', url: 'http://127.0.0.1:9999/mcp'}}}, null, 2)
  const fixture = makeRepo({mcpJsonTemplate: tpl})

  mkdirSync(join(fixture.wtPath, '.codex'), {recursive: true})
  writeFileSync(fixture.codexCfgPath, '[model]\nname = "gpt-5"\n', 'utf-8')

  runScript(fixture.wtPath, fixture.wtName, {VOICETREE_MCP_PORT: '4242'})

  const codex = readFileSync(fixture.codexCfgPath, 'utf-8')
  assert.match(codex, /\[model\]\s*\nname = "gpt-5"/, 'unrelated section preserved')
  assert.match(codex, /\[mcp_servers\.voicetree\]\s*\nurl = "http:\/\/localhost:4242\/mcp"/, 'voicetree section appended')
})

test('patches voicetree URL in .mcp.json (preserving the surrounding structure)', () => {
  const tpl = JSON.stringify(
    {
      mcpServers: {
        playwright: {type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest']},
        voicetree: {type: 'http', url: 'http://127.0.0.1:9999/mcp'},
      },
    },
    null,
    2,
  )
  const fixture = makeRepo({mcpJsonTemplate: tpl})

  runScript(fixture.wtPath, fixture.wtName, {VOICETREE_MCP_PORT: '4242'})

  const mcp = JSON.parse(readFileSync(fixture.mcpJsonPath, 'utf-8'))
  assert.equal(mcp.mcpServers.voicetree.url, 'http://localhost:4242/mcp')
  assert.equal(mcp.mcpServers.voicetree.type, 'http')
  assert.equal(mcp.mcpServers.playwright.command, 'npx', 'other server preserved')
})

test('silently skips MCP-URL sync when VOICETREE_MCP_PORT is unset (back-compat / manual invocation)', () => {
  const tpl = JSON.stringify({mcpServers: {voicetree: {type: 'http', url: 'http://127.0.0.1:9999/mcp'}}}, null, 2)
  const fixture = makeRepo({mcpJsonTemplate: tpl})

  // Explicitly unset
  const env = {...process.env}
  delete env.VOICETREE_MCP_PORT

  const result = spawnSync('sh', [SCRIPT, fixture.wtPath, fixture.wtName], {env, encoding: 'utf-8'})
  assert.equal(result.status, 0, `script should still succeed; stderr:\n${result.stderr}`)
  // No .codex written
  assert.equal(
    spawnSync('test', ['-f', fixture.codexCfgPath]).status,
    1,
    '.codex/config.toml should NOT exist when port is unset',
  )
})
