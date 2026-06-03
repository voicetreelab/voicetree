/**
 * Playwright globalSetup for the browser daemon round-trip tier.
 *
 * Boots ONE real `vt serve` (graphd + vtd, from tsx source bins) via the shared
 * @vt/daemon-test-harness, sets VOICETREE_CORS_ORIGINS so the spawned vtd accepts
 * the fixed web-server origin, then hands the live vtdUrl + bearer token + project
 * path off to the worker processes through a file (globalSetup and workers do not
 * share env). globalTeardown reads servePid/projectPath/homePath back to tear it
 * all down.
 */

import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {
  buildBrowserConfig,
  readAuthToken,
  spawnServe,
  type ServeHandle,
  type ServeReady,
} from '@vt/daemon-test-harness'
import {DAEMON_CONFIG_FILE} from './vt-e2e-helpers.ts'

const WEB_PORT: number = Number(process.env.PLAYWRIGHT_PORT ?? 3100)

export default async function globalSetup(): Promise<void> {
  const project: string = await mkdtemp(join(tmpdir(), 'vt-browser-rt-project-'))
  const home: string = await mkdtemp(join(tmpdir(), 'vt-browser-rt-home-'))
  await mkdir(join(project, '.voicetree'), {recursive: true})
  // Seed one root node so graphd has content and getGraph() returns a usable
  // task node for the round-trip / spawn tests.
  await writeFile(
    join(project, 'root.md'),
    '# Browser round-trip root\n\nSeed node for the daemon-integration e2e tier.\n',
    'utf8',
  )

  // The browser origin is the fixed web port (127.0.0.1 + localhost variants).
  const corsOrigins = `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}`
  const handle: ServeHandle = spawnServe(['--project', project], home, undefined, {
    VOICETREE_CORS_ORIGINS: corsOrigins,
  })

  const ready: ServeReady = await handle.ready
  const token: string = await readAuthToken(project)
  const cfg = buildBrowserConfig(ready, token, project)

  await mkdir(dirname(DAEMON_CONFIG_FILE), {recursive: true})
  await writeFile(
    DAEMON_CONFIG_FILE,
    JSON.stringify({...cfg, servePid: handle.child.pid, homePath: home}),
    'utf8',
  )
}
