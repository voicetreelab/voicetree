/**
 * Stage the per-project daemon bundles into the Electron main output so they
 * ship inside the packaged app.
 *
 * The packaged app spawns two Node daemons as separate child processes: vtd
 * (the per-project VoiceTree daemon) and its vt-graphd sibling. Neither can run
 * under the Electron binary, and neither ships TS source / tsx in production.
 * @vt/vt-daemon's build emits both as standalone ESM bundles; this script
 * co-locates them next to the compiled main bundle (dist-electron/main/) so:
 *   - @vt/vt-daemon-client's resolveCommand finds vtd.mjs via its sibling path
 *     (import.meta.url of the inlined client resolves to dist-electron/main/),
 *     and
 *   - the spawned vtd.mjs finds vt-graphd.mjs as ITS sibling.
 *
 * The bundles are marked asarUnpack in package.json so a plain Node child can
 * execute them from app.asar.unpacked (Node cannot read inside an asar), and so
 * their external native deps (node-pty, @vscode/ripgrep) resolve via the
 * node_modules walk-up from the unpacked tree.
 *
 * Must run AFTER `electron-vite build` (which creates dist-electron/main) and
 * BEFORE `electron-builder`.
 */
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const webappDir = resolve(__dirname, '..')
const repoRoot = resolve(webappDir, '..')
const vtDaemonDir = resolve(repoRoot, 'packages/systems/vt-daemon')
const mainOutDir = resolve(webappDir, 'dist-electron/main')

const BUNDLES = ['vtd.mjs', 'vt-graphd.mjs']

console.log('[stage-daemon-bundles] building @vt/vt-daemon bundles…')
// execSync (shell) so `pnpm` resolves to pnpm.cmd on Windows CI too.
execSync('pnpm --filter @vt/vt-daemon run build', {
  cwd: repoRoot,
  stdio: 'inherit',
})

if (!existsSync(mainOutDir)) {
  throw new Error(
    `[stage-daemon-bundles] ${mainOutDir} does not exist — run electron-vite build first.`,
  )
}

mkdirSync(mainOutDir, { recursive: true })
for (const bundle of BUNDLES) {
  const src = resolve(vtDaemonDir, 'dist', bundle)
  if (!existsSync(src)) {
    throw new Error(`[stage-daemon-bundles] expected daemon bundle missing: ${src}`)
  }
  const dest = resolve(mainOutDir, bundle)
  copyFileSync(src, dest)
  console.log(`[stage-daemon-bundles] staged ${bundle} → ${dest}`)
}
