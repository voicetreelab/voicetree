#!/usr/bin/env node
import {_electron as electron} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'e2e-tests', 'test-results', 'surviving-agents');
const TMUX_BIN = process.env.VT_TMUX_BIN ?? (process.platform === 'darwin' ? '/opt/homebrew/bin/tmux' : 'tmux');
const PROJECT_ID = 'surviving-agents-e2e';
const RESUME_TERMINAL_ID = 'Mira';
const RESUME_NATIVE_SESSION_ID = '0f4e2c3a-7b1d-4d9e-9a2f-8c7b6e5d4321';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function electronLinuxLaunchFlags() {
  return process.platform === 'linux'
    ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : [];
}

function pathEntryForCommand(command) {
  return command.includes(path.sep) ? path.dirname(command) : null;
}

function buildElectronTestPath(extraBinDirs = []) {
  return [
    ...extraBinDirs,
    pathEntryForCommand(TMUX_BIN),
    process.env.PATH ?? '',
  ].filter((entry) => typeof entry === 'string' && entry.length > 0).join(path.delimiter);
}

function buildNamespaceHash(projectRoot) {
  return createHash('sha1').update(path.join(projectRoot, '.voicetree')).digest('hex').slice(0, 10);
}

function buildSessionName(projectRoot, terminalId) {
  return `vt-${buildNamespaceHash(projectRoot)}-${terminalId}`;
}

function tmuxSocketPath(appSupportPath) {
  return path.join(appSupportPath, 'tmux.sock');
}

function assertRealClaudeAvailable() {
  const result = spawnSync('bash', ['-lc', 'command -v claude'], {encoding: 'utf8'});
  assert(result.status === 0 && result.stdout.trim().length > 0, `real claude binary not found on PATH; stdout=${result.stdout} stderr=${result.stderr}`);
  return result.stdout.trim();
}

async function createProofVault(tempRoot) {
  const projectRoot = path.join(tempRoot, 'resume-proof-vault');
  await fs.mkdir(path.join(projectRoot, '.voicetree', 'terminals'), {recursive: true});
  await fs.writeFile(path.join(projectRoot, 'readme.md'), [
    '---',
    'position:',
    '  x: 400',
    '  y: 300',
    '---',
    '# Resume Proof Context',
    '',
    'The resumed terminal should attach to this graph context node.',
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(projectRoot, 'task.md'), '# Resume task\n', 'utf8');
  return projectRoot;
}

async function fixtureClaudeTranscript({claudeProjectsRoot, terminalId, projectRoot, taskNodePath, sessionId}) {
  const subdir = path.join(claudeProjectsRoot, `vt-e2e-${terminalId}`);
  await fs.mkdir(subdir, {recursive: true});
  const transcriptPath = path.join(subdir, `${sessionId}.jsonl`);
  const markerText = [
    `VOICETREE_TERMINAL_ID = ${terminalId}`,
    `VOICETREE_VAULT_PATH = ${projectRoot}`,
    `TASK_NODE_PATH = ${taskNodePath}`,
  ].join('\n');
  await fs.writeFile(transcriptPath, `${JSON.stringify({
    sessionId,
    type: 'user',
    message: {role: 'user', content: markerText},
  })}\n`, 'utf8');
  return transcriptPath;
}

async function fixtureRecoveryMetadata({projectRoot, terminalId, agentName, cliBinary, taskNodePath}) {
  const metadataDir = path.join(projectRoot, '.voicetree', 'terminals');
  await fs.mkdir(metadataDir, {recursive: true});
  const metadataPath = path.join(metadataDir, `${terminalId}.json`);
  const projectDir = path.join(projectRoot, '.voicetree');
  await fs.writeFile(metadataPath, JSON.stringify({
    name: terminalId,
    status: 'running',
    session: buildSessionName(projectRoot, terminalId),
    startedAt: new Date().toISOString(),
    terminalData: {
      type: 'Terminal',
      terminalId,
      agentName,
      attachedToContextNodeId: path.join(projectRoot, 'readme.md'),
      initialCommand: cliBinary,
      initialEnvVars: {
        VOICETREE_TERMINAL_ID: terminalId,
        AGENT_NAME: agentName,
        VOICETREE_VAULT_PATH: projectRoot,
        VOICETREE_PROJECT_DIR: projectDir,
        TASK_NODE_PATH: taskNodePath,
      },
      isHeadless: false,
    },
  }, null, 2), 'utf8');
  return metadataPath;
}

async function waitForElectronWindow(electronApp, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const existingWindow = electronApp.windows()[0];
    if (existingWindow) return existingWindow;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Electron window; observed ${electronApp.windows().length} windows`);
}

async function waitForCondition(label, timeoutMs, fn) {
  const startedAt = Date.now();
  let lastValue;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await fn();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
}

function collectProcessTree(rootPid) {
  const script = [
    'set -euo pipefail',
    'root="$1"',
    'emit_tree() {',
    '  local pid="$1"',
    '  ps -p "$pid" -o pid=,ppid=,args= 2>/dev/null || true',
    '  (pgrep -P "$pid" 2>/dev/null || true) | while read -r child; do',
    '    emit_tree "$child"',
    '  done',
    '}',
    'emit_tree "$root"',
  ].join('\n');
  const result = spawnSync('bash', ['-lc', script, 'process-tree', String(rootPid)], {encoding: 'utf8'});
  assert(result.status === 0, `process tree collection failed: ${result.stderr}`);
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function tmuxPaneProcessLines(socketPath, sessionName) {
  const paneResult = spawnSync(TMUX_BIN, ['-S', socketPath, 'display-message', '-t', sessionName, '-p', '#{pane_pid}'], {encoding: 'utf8'});
  assert(paneResult.status === 0, `tmux pane pid lookup failed: ${paneResult.stderr}`);
  const panePid = Number(paneResult.stdout.trim());
  assert(Number.isInteger(panePid) && panePid > 0, `invalid tmux pane pid: ${paneResult.stdout}`);
  return collectProcessTree(panePid);
}

function assertRealResumeProcess(socketPath, sessionName) {
  const lines = tmuxPaneProcessLines(socketPath, sessionName);
  const expected = `claude --resume ${RESUME_NATIVE_SESSION_ID}`;
  assert(
    lines.some((line) => line.includes(expected)),
    `expected real process argv containing "${expected}". Process tree:\n${lines.join('\n')}`,
  );
  console.log(`Verified real process argv:\n${lines.join('\n')}`);
}

function parsePng(buffer) {
  assert(buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'Screenshot is not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  assert(width > 0 && height > 0 && idatChunks.length > 0, 'Screenshot PNG is missing IHDR or IDAT chunks');
  return {width, height, bitDepth, colorType, idat: Buffer.concat(idatChunks)};
}

function bytesPerPixel(info) {
  assert(info.bitDepth === 8, `Unsupported PNG bit depth: ${info.bitDepth}`);
  if (info.colorType === 0) return 1;
  if (info.colorType === 2) return 3;
  if (info.colorType === 4) return 2;
  if (info.colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type: ${info.colorType}`);
}

function unfilterPngRows(info) {
  const bpp = bytesPerPixel(info);
  const rowBytes = info.width * bpp;
  const inflated = inflateSync(info.idat);
  const output = Buffer.alloc(info.height * rowBytes);
  for (let y = 0; y < info.height; y += 1) {
    const sourceRowStart = y * (rowBytes + 1);
    const filter = inflated[sourceRowStart] ?? -1;
    const source = inflated.subarray(sourceRowStart + 1, sourceRowStart + 1 + rowBytes);
    const destRowStart = y * rowBytes;
    const prevRowStart = destRowStart - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = source[x] ?? 0;
      const left = x >= bpp ? output[destRowStart + x - bpp] ?? 0 : 0;
      const up = y > 0 ? output[prevRowStart + x] ?? 0 : 0;
      const upLeft = y > 0 && x >= bpp ? output[prevRowStart + x - bpp] ?? 0 : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`);
      output[destRowStart + x] = (raw + predicted) & 0xff;
    }
  }
  return output;
}

async function assertScreenshotNotBlank(screenshotPath) {
  const info = parsePng(await fs.readFile(screenshotPath));
  const bpp = bytesPerPixel(info);
  const pixels = unfilterPngRows(info);
  let visiblePixelCount = 0;
  for (let offset = 0; offset < pixels.length; offset += bpp) {
    const r = pixels[offset] ?? 0;
    const g = info.colorType === 0 || info.colorType === 4 ? r : pixels[offset + 1] ?? 0;
    const b = info.colorType === 0 || info.colorType === 4 ? r : pixels[offset + 2] ?? 0;
    const alpha = info.colorType === 4 ? pixels[offset + 1] ?? 255 : info.colorType === 6 ? pixels[offset + 3] ?? 255 : 255;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) * (alpha / 255);
    if (luminance > 16) visiblePixelCount += 1;
  }
  const visibleFraction = visiblePixelCount / (info.width * info.height);
  assert(visibleFraction > 0.002, `Screenshot ${screenshotPath} appears blank: visible fraction ${visibleFraction}`);
}

async function captureProofScreenshot(page, screenshotPath) {
  await page.screenshot({path: screenshotPath, fullPage: false});
  await assertScreenshotNotBlank(screenshotPath);
}

async function fitGraphToTerminalShadowNode(page, terminalId) {
  const result = await page.evaluate((id) => {
    const cy = window.cytoscapeInstance;
    if (!cy) throw new Error('cytoscapeInstance not available');
    const shadowNode = cy.getElementById(`${id}-anchor-shadowNode`);
    if (shadowNode.length === 0) throw new Error(`terminal shadow node not found for ${id}`);
    const leftInset = Array.from(document.querySelectorAll('[data-testid="terminal-tree-sidebar"], [data-testid="folder-tree-sidebar"]'))
      .filter((element) => element instanceof HTMLElement && window.getComputedStyle(element).display !== 'none')
      .reduce((total, element) => total + element.getBoundingClientRect().width, 0);
    cy.stop();
    cy.fit(shadowNode, 80);
    cy.pan({...cy.pan(), x: cy.pan().x + leftInset / 2});
    return {
      shadowNodeId: shadowNode.id(),
      parentNodeId: shadowNode.data('parentNodeId'),
      viewport: {pan: cy.pan(), zoom: cy.zoom()},
      boundingBox: shadowNode.boundingBox(),
    };
  }, terminalId);
  console.log(`Fit graph to terminal shadow node: ${JSON.stringify(result)}`);
}

async function closeFolderTreeIfVisible(page) {
  const closeButton = page.locator('[data-testid="folder-tree-sidebar"] .folder-tree-close-btn').first();
  if (await closeButton.count() === 0) return;
  if (!(await closeButton.isVisible().catch(() => false))) return;
  await closeButton.click();
  await page.waitForTimeout(300);
}

async function stopFileWatching(page) {
  await page.evaluate(async () => {
    const api = window.electronAPI;
    if (api) await api.main.stopFileWatching();
  }).catch(() => undefined);
}

async function closeElectronApp(electronApp) {
  const pid = electronApp.process()?.pid;
  const closeTask = electronApp.close().catch(() => undefined);
  const closed = await Promise.race([
    closeTask.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!closed && pid) {
    spawnSync('bash', ['-lc', `pkill -TERM -P ${pid} 2>/dev/null || true; kill -TERM ${pid} 2>/dev/null || true; sleep 0.5; pkill -KILL -P ${pid} 2>/dev/null || true; kill -KILL ${pid} 2>/dev/null || true`], {stdio: 'ignore'});
  }
}

function killProcessesContainingPath(targetPath) {
  const quotedPath = shellQuote(targetPath);
  spawnSync('bash', ['-lc', `pkill -TERM -f -- ${quotedPath} 2>/dev/null || true; sleep 0.5; pkill -KILL -f -- ${quotedPath} 2>/dev/null || true`], {stdio: 'ignore'});
}

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, {recursive: true});
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-resume-proof-'));
  const tempUserDataPath = path.join(tempRoot, 'app');
  const claudeProjectsRoot = path.join(tempRoot, 'claude-projects');
  await fs.mkdir(tempUserDataPath, {recursive: true});
  await fs.mkdir(claudeProjectsRoot, {recursive: true});

  const realClaudePath = assertRealClaudeAvailable();
  const projectRoot = await createProofVault(tempRoot);
  const resumeTmuxSocketPath = tmuxSocketPath(tempUserDataPath);
  const resumeSessionName = buildSessionName(projectRoot, RESUME_TERMINAL_ID);
  const taskNodePath = path.join(projectRoot, 'task.md');
  let electronApp;
  let page;
  let metadataPath;
  let transcriptPath;

  try {
    await fs.writeFile(path.join(tempUserDataPath, 'voicetree-config.json'), JSON.stringify({
      lastDirectory: projectRoot,
      vaultConfig: {[projectRoot]: {writeFolder: projectRoot, readPaths: []}},
    }, null, 2), 'utf8');
    await fs.writeFile(path.join(tempUserDataPath, 'projects.json'), JSON.stringify([{
      id: PROJECT_ID,
      path: projectRoot,
      name: PROJECT_ID,
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true,
    }], null, 2), 'utf8');

    electronApp = await electron.launch({
      args: [
        ...electronLinuxLaunchFlags(),
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
      ],
      env: {
        ...process.env,
        PATH: buildElectronTestPath(),
        HOME: tempUserDataPath,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '0',
        VOICETREE_PERSIST_STATE: '1',
        VOICETREE_APP_SUPPORT: tempUserDataPath,
        VOICETREE_CLAUDE_PROJECTS_DIR: claudeProjectsRoot,
      },
      timeout: 15000,
    });
    console.log(`Using real claude binary: ${realClaudePath}`);

    page = await waitForElectronWindow(electronApp, 60000);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => !!window.electronAPI?.main?.startFileWatching, {timeout: 15000});
    const watchResult = await page.evaluate(async (root) => window.electronAPI.main.startFileWatching(root), projectRoot);
    assert(watchResult.success, watchResult.error ?? 'startFileWatching failed');
    await page.waitForFunction(() => !!window.cytoscapeInstance, {timeout: 30000});
    await waitForCondition('graph to load', 20000, () => page.evaluate(() => (window.cytoscapeInstance?.nodes().length ?? 0) >= 1));
    await closeFolderTreeIfVisible(page);

    metadataPath = await fixtureRecoveryMetadata({
      projectRoot,
      terminalId: RESUME_TERMINAL_ID,
      agentName: RESUME_TERMINAL_ID,
      cliBinary: 'claude',
      taskNodePath,
    });
    transcriptPath = await fixtureClaudeTranscript({
      claudeProjectsRoot,
      terminalId: RESUME_TERMINAL_ID,
      projectRoot,
      taskNodePath,
      sessionId: RESUME_NATIVE_SESSION_ID,
    });
    await page.evaluate(async () => window.electronAPI.main.refreshRecoverySessions());

    const row = page.locator(`[data-has-resume="true"][data-terminal-id="${RESUME_TERMINAL_ID}"]`);
    await row.waitFor({state: 'visible', timeout: 10000});
    const beforeClickPath = path.join(SCREENSHOT_DIR, 'resume-proof-before-click.png');
    await captureProofScreenshot(page, beforeClickPath);
    console.log(`Before-click screenshot: ${beforeClickPath}`);

    const resumeButton = row.getByRole('button', {name: /resume claude session/i});
    await resumeButton.click({force: true, timeout: 10000});

    await waitForCondition('resumable row to disappear', 15000, () => page.locator(`[data-has-resume="true"][data-terminal-id="${RESUME_TERMINAL_ID}"]`).count().then((count) => count === 0));
    await page.locator(`.terminal-tree-node[data-terminal-id="${RESUME_TERMINAL_ID}"]`).waitFor({state: 'visible', timeout: 15000});
    await page.locator(`[data-floating-window-id="${RESUME_TERMINAL_ID}"]`).waitFor({state: 'visible', timeout: 15000});
    await waitForCondition('resumed tmux session', 10000, () => spawnSync(TMUX_BIN, ['-S', resumeTmuxSocketPath, 'has-session', '-t', resumeSessionName], {encoding: 'utf8'}).status === 0);
    await waitForCondition('real Claude resume argv', 15000, () => {
      try {
        assertRealResumeProcess(resumeTmuxSocketPath, resumeSessionName);
        return true;
      } catch (error) {
        console.warn(`Waiting for real Claude resume argv: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    });

    await fitGraphToTerminalShadowNode(page, RESUME_TERMINAL_ID);
    await page.waitForTimeout(1000);
    const afterClickPath = path.join(SCREENSHOT_DIR, 'resume-proof-after-click-shadow-fit.png');
    await captureProofScreenshot(page, afterClickPath);
    console.log(`After-click screenshot: ${afterClickPath}`);

    await page.waitForTimeout(15000);
    await fitGraphToTerminalShadowNode(page, RESUME_TERMINAL_ID);
    await page.waitForTimeout(1000);
    const after15sPath = path.join(SCREENSHOT_DIR, 'resume-proof-after-click-15s-shadow-fit.png');
    await captureProofScreenshot(page, after15sPath);
    console.log(`After-15s screenshot: ${after15sPath}`);
  } finally {
    if (metadataPath) await fs.rm(metadataPath, {force: true});
    if (transcriptPath) await fs.rm(transcriptPath, {force: true});
    spawnSync(TMUX_BIN, ['-S', resumeTmuxSocketPath, 'kill-session', '-t', resumeSessionName], {stdio: 'ignore'});
    spawnSync(TMUX_BIN, ['-S', resumeTmuxSocketPath, 'kill-server'], {stdio: 'ignore'});
    if (page) await stopFileWatching(page);
    if (electronApp) await closeElectronApp(electronApp);
    killProcessesContainingPath(tempRoot);
    await fs.rm(tempRoot, {recursive: true, force: true});
  }
}

main().then(() => {
  console.log('Resume proof completed.');
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
