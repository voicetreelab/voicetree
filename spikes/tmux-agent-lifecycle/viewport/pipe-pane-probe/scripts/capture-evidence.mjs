import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const probeDir = path.resolve(__dirname, '..');
const evidenceDir = path.join(probeDir, 'EVIDENCE');
const streamDir = path.join(probeDir, '.runtime-streams');
const port = Number(process.env.PORT || 4176);
const baseUrl = `http://127.0.0.1:${port}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killPpSessions() {
  const list = spawnSync('tmux', ['ls'], { encoding: 'utf8' });
  if (list.status !== 0) return;
  for (const line of list.stdout.split('\n')) {
    const match = line.match(/^(pp-[^:]+):/);
    if (match) spawnSync('tmux', ['kill-session', '-t', match[1]], { stdio: 'ignore' });
  }
}

function tmux(args, options = {}) {
  const result = spawnSync('tmux', args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`tmux ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout;
}

async function post(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : undefined
  });
  if (!response.ok) throw new Error(`${pathname} failed: ${await response.text()}`);
  return response.json();
}

async function waitForPaneText(session, text, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = spawnSync('tmux', ['capture-pane', '-e', '-J', '-p', '-t', session, '-S', '-200'], {
      encoding: 'utf8'
    });
    if (result.stdout.includes(text)) return result.stdout;
    await delay(100);
  }
  throw new Error(`timed out waiting for ${text} in ${session}`);
}

async function waitForStream(agent, predicate, timeout = 20000) {
  const streamPath = path.join(streamDir, `${agent}.stream.log`);
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const text = existsSync(streamPath) ? await readFile(streamPath, 'utf8') : '';
    if (predicate(text)) return text;
    await delay(100);
  }
  return existsSync(streamPath) ? readFile(streamPath, 'utf8') : '';
}

async function typeCommand(page, command) {
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText(command);
  await page.keyboard.press('Enter');
}

function countMatches(text, regex) {
  return Array.from(text.matchAll(regex)).length;
}

function summarizeCursor(text) {
  return {
    carriageReturns: countMatches(text, /\r/g),
    cursorAddressingSequences: countMatches(text, /\x1b\[[0-9;?]*[ABCDGHJKhl]/g),
    backspaces: countMatches(text, /\x08/g)
  };
}

await mkdir(evidenceDir, { recursive: true });
killPpSessions();
await rm(streamDir, { recursive: true, force: true });
await mkdir(streamDir, { recursive: true });

const server = spawn('node', ['server.mjs'], {
  cwd: probeDir,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});

let browser;
const results = {
  startedAt: new Date().toISOString(),
  smoke: { verdict: 'FAIL' },
  altScreen: { verdict: 'FAIL', toggleCount: 0 },
  cursor: { verdict: 'INCONCLUSIVE' },
  paste: { verdict: 'INCONCLUSIVE', bytesSent: 0 },
  recommendation: 'INCONCLUSIVE - blocker: capture script did not finish'
};

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

  browser = await chromium.launch({ headless: true });
  const smoke = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  await smoke.goto(`${baseUrl}/?agent=Smoke&command=bash`);
  await waitForPaneText('pp-Smoke', 'bash-');
  await typeCommand(
    smoke,
    "printf '\\033[32mPIPE_PANE_SMOKE_ANSI\\033[0m\\n'; claude --print 'Reply with PIPE_PANE_RENDER_PASS and nothing else.'; echo PIPE_PANE_SMOKE_DONE"
  );
  await waitForPaneText('pp-Smoke', 'PIPE_PANE_RENDER_PASS');
  await waitForPaneText('pp-Smoke', 'PIPE_PANE_SMOKE_DONE');
  await delay(750);
  await smoke.screenshot({ path: path.join(evidenceDir, 'render.png'), fullPage: true });
  results.smoke = { verdict: 'PASS', screenshot: 'EVIDENCE/render.png' };

  const tui = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  await tui.goto(`${baseUrl}/?agent=Tui&command=claude`);
  const tuiStream = await waitForStream('Tui', (text) => text.includes('esc to interrupt') || text.includes('Welcome'), 20000);
  await delay(2500);
  const postStartStream = await waitForStream('Tui', (text) => text.length > tuiStream.length + 20, 3000);
  const altToggleCount = countMatches(postStartStream || tuiStream, /\x1b\[\?1049[hl]/g);
  const cursorStats = summarizeCursor(postStartStream || tuiStream);
  results.altScreen = {
    verdict: altToggleCount > 0 ? 'PASS' : 'FAIL',
    toggleCount: altToggleCount,
    containsEnter: (postStartStream || tuiStream).includes('\x1b[?1049h'),
    containsExit: (postStartStream || tuiStream).includes('\x1b[?1049l')
  };
  results.cursor = {
    verdict: cursorStats.carriageReturns > 0 || cursorStats.cursorAddressingSequences > 0 ? 'PASS' : 'FAIL',
    ...cursorStats
  };
  await tui.screenshot({ path: path.join(evidenceDir, 'tui-or-fail.png'), fullPage: true });

  const payload = spawnSync('bash', ['-lc', 'head -c 5000 /dev/urandom | base64'], { encoding: 'utf8' }).stdout.replace(/\s+/g, '');
  const firstToken = payload.slice(0, 24);
  const lastToken = payload.slice(-24);
  tmux(['send-keys', '-t', 'pp-Tui', '-l', '--', payload]);
  await delay(1000);
  const paneAfterPaste = tmux(['capture-pane', '-e', '-J', '-p', '-t', 'pp-Tui', '-S', '-200']);
  const streamAfterPaste = await readFile(path.join(streamDir, 'Tui.stream.log'), 'utf8');
  const pasteSeen = paneAfterPaste.includes(firstToken) && paneAfterPaste.includes(lastToken);
  const pasteStreamSeen = streamAfterPaste.includes(firstToken) && streamAfterPaste.includes(lastToken);
  results.paste = {
    verdict: pasteSeen ? 'PASS' : 'FAIL',
    bytesSent: payload.length,
    firstTokenSeenInPane: paneAfterPaste.includes(firstToken),
    lastTokenSeenInPane: paneAfterPaste.includes(lastToken),
    firstTokenSeenInStream: streamAfterPaste.includes(firstToken),
    lastTokenSeenInStream: streamAfterPaste.includes(lastToken),
    note: pasteSeen
      ? 'One tmux send-keys -l invocation appeared as one contiguous input buffer in the Claude TUI pane.'
      : 'The full pasted buffer was not visible as a contiguous input buffer in the pane.'
  };
  await tui.screenshot({ path: path.join(evidenceDir, 'paste.png'), fullPage: true });

  await cp(path.join(streamDir, 'Smoke.stream.log'), path.join(evidenceDir, 'smoke.stream.log'));
  await cp(path.join(streamDir, 'Tui.stream.log'), path.join(evidenceDir, 'tui.stream.log'));

  const viable = results.smoke.verdict === 'PASS' && results.altScreen.verdict === 'PASS' && results.cursor.verdict === 'PASS' && results.paste.verdict === 'PASS';
  results.recommendation = viable
    ? 'pipe-pane is viable replacement for node-pty'
    : 'pipe-pane has same fidelity ceiling as polling, node-pty needed';
  results.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (browser) await browser.close();
  await post('/api/kill?agent=Smoke').catch(() => {});
  await post('/api/kill?agent=Tui').catch(() => {});
  killPpSessions();
  server.kill('SIGTERM');
  await writeFile(path.join(evidenceDir, 'capture-results.json'), `${JSON.stringify(results, null, 2)}\n`);
}
