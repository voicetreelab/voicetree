import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewportDir = path.resolve(__dirname, '..');
const lifecycleDir = path.resolve(viewportDir, '..');
const evidenceDir = path.join(viewportDir, 'EVIDENCE');
const projectDir = path.join(viewportDir, '.runtime-project');
const agent = process.env.VIEWPORT_AGENT || 'BF203';
const port = Number(process.env.PORT || 4173);
const baseUrl = `http://127.0.0.1:${port}`;

async function post(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { method: 'POST' });
  if (!response.ok) throw new Error(`${pathname} failed: ${await response.text()}`);
  return response.json();
}

function runLifecycleScript(script, args = []) {
  return new Promise((resolve) => {
    const child = spawn('bash', [path.join(lifecycleDir, script), ...args], {
      cwd: lifecycleDir,
      env: { ...process.env, PROJECT_DIR: projectDir },
      stdio: 'ignore'
    });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPaneText(text, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = spawnSync('tmux', ['capture-pane', '-e', '-J', '-p', '-t', `vt-${agent}`, '-S', '-200'], {
      encoding: 'utf8'
    });
    if (result.stdout.includes(text)) return;
    await delay(100);
  }
  throw new Error(`timed out waiting for tmux pane text: ${text}`);
}

async function typeCommand(page, command) {
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText(command);
  await page.keyboard.press('Enter');
}

await mkdir(evidenceDir, { recursive: true });
await runLifecycleScript('kill-agent.sh', [agent]);
await rm(projectDir, { recursive: true, force: true });

const server = spawn('node', ['src/server.mjs'], {
  cwd: viewportDir,
  env: { ...process.env, PORT: String(port), VIEWPORT_AGENT: agent, PROJECT_DIR: projectDir },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await new Promise((resolve, reject) => {
    const started = setInterval(() => {
      if (serverOutput.includes('listening')) {
        clearInterval(started);
        resolve();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(started);
      reject(new Error(`server did not start:\n${serverOutput}`));
    }, 10000);
  });

  await post(`/api/spawn?agent=${encodeURIComponent(agent)}`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/?agent=${encodeURIComponent(agent)}`);
  await waitForPaneText('bash-');
  await delay(300);

  await typeCommand(
    page,
    "printf '\\033[32mBF203_RENDER_ANSI\\033[0m\\n'; for i in 1 2 3; do echo BF203_RENDER_TICK_$i; sleep 0.25; done; claude --print 'Reply with the uppercase token formed by RENDER plus underscore plus PASS, and nothing else.'; echo BF203_RENDER_DONE"
  );
  await waitForPaneText('RENDER_PASS');
  await waitForPaneText('BF203_RENDER_DONE');
  await delay(500);
  await page.screenshot({ path: path.join(evidenceDir, 'render.png'), fullPage: true });

  await typeCommand(page, 'clear');
  await delay(300);
  await typeCommand(page, "claude --print 'Reply with the uppercase token formed by KEYSTROKE plus underscore plus PASS, and nothing else.'; echo BF203_KEYSTROKE_DONE");
  await waitForPaneText('KEYSTROKE_PASS');
  await waitForPaneText('BF203_KEYSTROKE_DONE');
  await delay(500);
  await page.screenshot({ path: path.join(evidenceDir, 'keystroke.png'), fullPage: true });

  const metrics = await (await fetch(`${baseUrl}/api/metrics`)).json();
  console.log(JSON.stringify({ ok: true, evidenceDir, metrics }, null, 2));
  await browser.close();
} finally {
  await post(`/api/kill?agent=${encodeURIComponent(agent)}`).catch(() => {});
  server.kill('SIGTERM');
}
