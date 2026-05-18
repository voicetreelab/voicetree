import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const spikeDir = path.resolve(__dirname, '..');
const evidenceDir = path.join(spikeDir, 'EVIDENCE');
const port = Number(process.env.PORT || 4277);
const baseUrl = `http://127.0.0.1:${port}`;

const results = {
  A_render_pass: false,
  B_keystroke_pass: false,
  C_n3_pass: false,
  D_reattach_pass: false,
  D_history_lines_recovered: 0,
  paste_pass: false,
  paste_lines_received: 0,
  latency_p50_ms: null,
  latency_p95_ms: null,
  node_pty_install_ok: true,
  notes: []
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || spikeDir,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.stdio || 'pipe'
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout || '';
}

function hasSession(name) {
  return spawnSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' }).status === 0;
}

function killSession(name) {
  spawnSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' });
}

function cleanupNpSessions() {
  const listed = spawnSync('tmux', ['ls'], { encoding: 'utf8' });
  if (listed.status !== 0) return;
  for (const line of listed.stdout.split('\n')) {
    const name = line.split(':')[0];
    if (name.startsWith('np-')) killSession(name);
  }
}

function createSession(name) {
  if (hasSession(name)) killSession(name);
  run('tmux', ['new-session', '-d', '-s', name, '-x', '120', '-y', '40']);
}

function capturePane(name) {
  const result = spawnSync('tmux', ['capture-pane', '-e', '-J', '-p', '-t', name, '-S', '-3000'], {
    encoding: 'utf8'
  });
  return result.stdout || '';
}

function tmuxSend(name, data) {
  run('tmux', ['send-keys', '-t', name, '-l', '--', data]);
}

function tmuxEnter(name) {
  run('tmux', ['send-keys', '-t', name, 'Enter']);
}

async function waitForTerminalText(page, text, timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await page.evaluate((needle) => window.__terminalText?.().includes(needle), text).catch(() => false);
    if (found) return;
    await delay(100);
  }
  throw new Error(`timed out waiting for terminal text: ${text}`);
}

async function waitForPaneText(name, text, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const pane = capturePane(name);
    if (pane.includes(text)) return pane;
    await delay(100);
  }
  throw new Error(`timed out waiting for tmux pane text: ${text}`);
}

async function openTerminal(browser, name, viewport = { width: 1280, height: 760 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/?name=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => window.__sendTerminalData && window.__terminalText);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'connected');
  await delay(250);
  return page;
}

async function keyboardCommand(page, command) {
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText(command);
  await page.keyboard.press('Enter');
}

async function sendTerminalData(page, data) {
  const ok = await page.evaluate((payload) => window.__sendTerminalData(payload), data);
  if (!ok) throw new Error('terminal websocket was not open');
}

async function command(page, text) {
  await sendTerminalData(page, `${text}\r`);
}

async function screenshot(page, fileName) {
  await delay(500);
  await page.screenshot({ path: path.join(evidenceDir, fileName), fullPage: true });
}

async function runRender(browser) {
  const name = 'np-render';
  createSession(name);
  const page = await openTerminal(browser, name);
  await keyboardCommand(
    page,
    "printf '\\033[32mBF207_RENDER_ANSI\\033[0m\\n'; claude --print 'Reply exactly BF207_RENDER_PASS and nothing else.'; echo BF207_RENDER_DONE"
  );
  await waitForTerminalText(page, 'BF207_RENDER_PASS');
  await waitForTerminalText(page, 'BF207_RENDER_DONE');
  await screenshot(page, 'render.png');
  results.A_render_pass = true;
  await page.close();
}

async function runKeystrokeAndResize(browser) {
  const name = 'np-key';
  createSession(name);
  const page = await openTerminal(browser, name);
  await keyboardCommand(
    page,
    "claude --print 'Reply exactly BF207_KEYSTROKE_PASS and nothing else.'; echo BF207_KEYSTROKE_DONE"
  );
  await waitForTerminalText(page, 'BF207_KEYSTROKE_PASS');
  await waitForTerminalText(page, 'BF207_KEYSTROKE_DONE');
  await screenshot(page, 'keystroke.png');
  results.B_keystroke_pass = true;
  await page.evaluate(() => window.__resizeTerminal(100, 28));
  await delay(250);
  const paneSize = run('tmux', ['display-message', '-p', '-t', name, '#{pane_width} #{pane_height}']).trim();
  results.notes.push(`Resize request sent through WS resize -> node-pty resize; tmux pane reports ${paneSize}.`);
  await page.close();
}

async function runMulti(browser) {
  const names = ['np-multi-1', 'np-multi-2', 'np-multi-3'];
  for (const name of names) createSession(name);
  const pages = [];
  for (const name of names) pages.push(await openTerminal(browser, name, { width: 900, height: 520 }));
  await Promise.all(
    pages.map((page, index) =>
      keyboardCommand(
        page,
        `claude --print 'Reply exactly BF207_MULTI_${index + 1}_PASS and nothing else.'; echo BF207_MULTI_${index + 1}_DONE`
      )
    )
  );
  await Promise.all(
    pages.map(async (page, index) => {
      await waitForTerminalText(page, `BF207_MULTI_${index + 1}_PASS`);
      await waitForTerminalText(page, `BF207_MULTI_${index + 1}_DONE`);
    })
  );

  const dashboard = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
  const frames = names
    .map(
      (name) =>
        `<iframe src="${baseUrl}/?name=${encodeURIComponent(name)}" style="width: 32.8%; height: 850px; border: 1px solid #334155;"></iframe>`
    )
    .join('');
  await dashboard.setContent(`<body style="margin:0;background:#0f1217;display:flex;gap:6px;">${frames}</body>`);
  await delay(1500);
  await dashboard.screenshot({ path: path.join(evidenceDir, 'multi-3.png'), fullPage: true });
  await dashboard.close();
  for (const page of pages) await page.close();
  results.C_n3_pass = true;
}

async function runReattach(browser) {
  const name = 'np-reattach';
  createSession(name);
  let page = await openTerminal(browser, name);
  await command(page, "echo BF207_REATTACH_BEFORE");
  await waitForTerminalText(page, 'BF207_REATTACH_BEFORE');
  await screenshot(page, 'reattach-before.png');
  await page.close();
  await delay(500);
  if (!hasSession(name)) throw new Error('tmux session died after browser close');

  tmuxSend(name, "printf 'BF207_DISCONNECTED_LINE_1\\nBF207_DISCONNECTED_LINE_2\\n'");
  tmuxEnter(name);
  const start = Date.now();
  while (Date.now() - start < 10000 && !capturePane(name).includes('BF207_DISCONNECTED_LINE_1')) {
    await delay(100);
  }

  page = await openTerminal(browser, name);
  await waitForTerminalText(page, 'BF207_DISCONNECTED_LINE_1');
  await waitForTerminalText(page, 'BF207_DISCONNECTED_LINE_2');
  await screenshot(page, 'reattach-after.png');
  const text = await page.evaluate(() => window.__terminalText());
  results.D_history_lines_recovered = ['BF207_DISCONNECTED_LINE_1', 'BF207_DISCONNECTED_LINE_2'].filter((line) =>
    text.includes(line)
  ).length;
  results.D_reattach_pass = results.D_history_lines_recovered >= 1;
  await page.close();
}

async function runPaste(browser) {
  const name = 'np-paste';
  createSession(name);
  const page = await openTerminal(browser, name);
  await command(page, "rm -f /tmp/bf207-paste.txt; printf 'BF207_CAT_READY\\n'; cat > /tmp/bf207-paste.txt");
  await waitForTerminalText(page, 'BF207_CAT_READY');
  await delay(250);
  const lines = Array.from({ length: 200 }, (_, index) => `BF207_PASTE_LINE_${String(index + 1).padStart(3, '0')}`);
  await sendTerminalData(page, `${lines.join('\r')}\r`);
  await waitForTerminalText(page, 'BF207_PASTE_LINE_200');
  await delay(500);
  await sendTerminalData(page, '\u0004');
  await command(
    page,
    "printf 'BF207_PASTE_COUNT='; wc -l < /tmp/bf207-paste.txt; printf 'BF207_PASTE_LAST='; tail -n 1 /tmp/bf207-paste.txt"
  );
  await waitForTerminalText(page, 'BF207_PASTE_LAST=BF207_PASTE_LINE_200');
  const text = await page.evaluate(() => window.__terminalText());
  const match = text.match(/BF207_PASTE_COUNT=\s*(\d+)/);
  results.paste_lines_received = match ? Number(match[1]) : 0;
  results.paste_pass = results.paste_lines_received === 200 && text.includes('BF207_PASTE_LINE_199');
  await screenshot(page, 'paste.png');
  await page.close();
}

async function runLatency(browser) {
  const name = 'np-latency';
  createSession(name);
  const page = await openTerminal(browser, name);
  await command(page, "printf 'BF207_LATENCY_READY\\n'; while IFS= read -r line; do printf '%s\\n' \"$line\"; done");
  await waitForTerminalText(page, 'BF207_LATENCY_READY');
  const samples = [];
  for (let i = 0; i < 100; i += 1) {
    const token = `BF207_LATENCY_${String(i).padStart(3, '0')}`;
    const start = Date.now();
    await sendTerminalData(page, `${token}\r`);
    await waitForTerminalText(page, token, 10000);
    samples.push(Date.now() - start);
    await delay(5);
  }
  samples.sort((a, b) => a - b);
  results.latency_p50_ms = samples[Math.floor(samples.length * 0.5)];
  results.latency_p95_ms = samples[Math.floor(samples.length * 0.95)];
  results.notes.push(`Latency measured as command send -> token visible in xterm buffer over ${samples.length} shell echoes.`);
  await page.close();
}

async function writeResults() {
  await writeFile(path.join(spikeDir, 'RESULTS.json'), `${JSON.stringify(results, null, 2)}\n`);
  const verdict =
    results.A_render_pass &&
    results.B_keystroke_pass &&
    results.C_n3_pass &&
    results.D_reattach_pass &&
    results.paste_pass
      ? 'GO'
      : 'PIVOT';
  const md = `# BF-207 node-pty + tmux attach results

## Verdict
${verdict} for the node-pty \`tmux attach\` bridge.

## Results
- node_pty_install_ok: ${results.node_pty_install_ok}
- A_render_pass: ${results.A_render_pass}
- B_keystroke_pass: ${results.B_keystroke_pass}
- C_n3_pass: ${results.C_n3_pass}
- D_reattach_pass: ${results.D_reattach_pass} (${results.D_history_lines_recovered} disconnected history lines recovered)
- paste_pass: ${results.paste_pass} (${results.paste_lines_received} lines received)
- latency_p50_ms: ${results.latency_p50_ms}
- latency_p95_ms: ${results.latency_p95_ms}

## Notes
${results.notes.map((note) => `- ${note}`).join('\n') || '- No extra notes.'}
`;
  await writeFile(path.join(spikeDir, 'RESULTS.md'), md);
}

await mkdir(evidenceDir, { recursive: true });
cleanupNpSessions();

const claudeVersion = spawnSync('claude', ['--version'], { encoding: 'utf8' });
if (claudeVersion.status === 0) {
  results.notes.push(`claude version: ${claudeVersion.stdout.trim() || claudeVersion.stderr.trim()}`);
} else {
  results.notes.push(`claude --version failed: ${(claudeVersion.stderr || claudeVersion.stdout || '').trim()}`);
}
results.notes.push(
  'node-pty npm install succeeded, but first runtime spawn failed with posix_spawnp failed until npm rebuild node-pty --build-from-source was run locally.'
);

const server = spawn('node', ['src/server.mjs'], {
  cwd: spikeDir,
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

try {
  const started = Date.now();
  while (!serverOutput.includes('listening')) {
    if (Date.now() - started > 10000) throw new Error(`server did not start:\n${serverOutput}`);
    await delay(50);
  }
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, fn] of [
      ['A render', runRender],
      ['B keystroke + resize', runKeystrokeAndResize],
      ['C n=3', runMulti],
      ['D reattach', runReattach],
      ['paste', runPaste],
      ['latency', runLatency]
    ]) {
      try {
        await fn(browser);
      } catch (error) {
        results.notes.push(`${name} failed: ${error.message}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
} catch (error) {
  results.notes.push(`fatal test harness failure: ${error.message}`);
} finally {
  server.kill('SIGTERM');
  cleanupNpSessions();
  await writeResults();
}

console.log(JSON.stringify(results, null, 2));
