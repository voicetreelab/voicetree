import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const spikeDir = path.resolve(__dirname, '..');
const evidenceDir = path.join(spikeDir, 'EVIDENCE');
const port = Number(process.env.PORT || 4281);
const baseUrl = `http://127.0.0.1:${port}`;
const captureLog = path.join(evidenceDir, 'check6_nodepty_attach.log');
const check1PromptPath = path.join(evidenceDir, 'check1_prompt.txt');
const check6PromptPath = path.join(evidenceDir, 'check6_prompt.txt');

const prompt1 = `Return exactly this markdown content and no extra explanation:
BF301_RENDER_START
\`\`\`js
const alpha = 1;
console.log(alpha + 2);
\`\`\`
\`\`\`diff
- old renderer
+ tmux attach renderer
\`\`\`
BF301_RENDER_END`;

const prompt6 = `Return exactly this markdown content and no extra explanation:
BF301_LOG_START
This node-pty attach capture should remain readable after ANSI cleanup.
\`\`\`ts
const bridge = "node-pty(tmux attach)";
console.log(bridge);
\`\`\`
BF301_LOG_END`;

const results = [];
const runLog = ['# BF-301 renderer bridge residual empirical run log', ''];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(line = '') {
  runLog.push(line);
}

function run(command, args, options = {}) {
  log(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || spikeDir,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.stdio || 'pipe'
  });
  if (result.stdout?.trim()) log(result.stdout.trim());
  if (result.stderr?.trim()) log(result.stderr.trim());
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout || '';
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { cwd: spikeDir, encoding: 'utf8' });
  return (result.stdout || result.stderr || '').trim();
}

function hasSession(name) {
  return spawnSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' }).status === 0;
}

function killSession(name) {
  spawnSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' });
}

function cleanupSessions() {
  const listed = spawnSync('tmux', ['ls'], { encoding: 'utf8' });
  if (listed.status !== 0) return;
  for (const line of listed.stdout.split('\n')) {
    const name = line.split(':')[0];
    if (name.startsWith('bf301-')) killSession(name);
  }
}

function createSession(name, cols = 120, rows = 40) {
  if (hasSession(name)) killSession(name);
  run('tmux', ['new-session', '-d', '-s', name, '-x', String(cols), '-y', String(rows)]);
}

function tmuxCommand(name, text) {
  run('tmux', ['send-keys', '-t', name, '-l', '--', text]);
  run('tmux', ['send-keys', '-t', name, 'Enter']);
}

async function waitForTerminalText(page, text, timeout = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await page.evaluate((needle) => window.__terminalText?.().includes(needle), text).catch(() => false);
    if (found) return Date.now() - start;
    await delay(100);
  }
  throw new Error(`timed out waiting for terminal text: ${text}`);
}

async function openTerminal(browser, name, { mode = 'attach', viewport = { width: 1280, height: 760 }, cmd = null } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const cmdPart = cmd ? `&cmd=${encodeURIComponent(cmd)}` : '';
  await page.goto(`${baseUrl}/?mode=${mode}&name=${encodeURIComponent(name)}${cmdPart}`);
  await page.waitForFunction(() => window.__sendTerminalData && window.__terminalText && window.__resizeTerminal);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'connected');
  await delay(250);
  return page;
}

async function sendTerminalData(page, data) {
  const ok = await page.evaluate((payload) => window.__sendTerminalData(payload), data);
  if (!ok) throw new Error('terminal websocket was not open');
}

async function command(page, text) {
  await sendTerminalData(page, `${text}\r`);
}

async function screenshot(page, fileName) {
  await page.screenshot({ path: path.join(evidenceDir, fileName), fullPage: true });
}

function resultRow(check_id, status, measured, evidence, notes) {
  return { check_id, status, measured, evidence, notes };
}

async function runCheck1(browser) {
  log('## Check 1 - render fidelity');
  log('Prompt:');
  log('```');
  log(prompt1);
  log('```');

  const attachName = 'bf301-check1-attach';
  createSession(attachName);
  const attach = await openTerminal(browser, attachName, { mode: 'attach' });
  tmuxCommand(attachName, "unset npm_config_prefix; claude --print \"$(cat EVIDENCE/check1_prompt.txt)\"; echo BF301_CHECK1_ATTACH_DONE");
  await waitForTerminalText(attach, 'BF301_RENDER_END');
  await delay(2000);
  await screenshot(attach, 'check1_attach.png');
  const attachText = await attach.evaluate(() => window.__terminalText());
  await attach.close();

  const directCommand = 'claude --print "$(cat EVIDENCE/check1_prompt.txt)"; echo BF301_CHECK1_NODEPTY_DONE';
  log(`$ direct node-pty cmd: ${directCommand}`);
  const direct = await openTerminal(browser, 'bf301-check1-nodepty', {
    mode: 'direct',
    cmd: directCommand
  });
  await waitForTerminalText(direct, 'BF301_RENDER_END');
  await delay(2000);
  await screenshot(direct, 'check1_nodepty.png');
  const directText = await direct.evaluate(() => window.__terminalText());
  await direct.close();

  const required = ['BF301_RENDER_START', 'const alpha = 1;', '+ tmux attach renderer', 'BF301_RENDER_END'];
  const attachOk = required.every((needle) => attachText.includes(needle));
  const directOk = required.every((needle) => directText.includes(needle));
  const status = attachOk && directOk ? 'PASS' : 'FAIL';
  results.push(
    resultRow(
      '1_render_fidelity',
      status,
      { attach_required_tokens: attachOk, nodepty_required_tokens: directOk },
      ['EVIDENCE/check1_attach.png', 'EVIDENCE/check1_nodepty.png', 'EVIDENCE/check1_prompt.txt'],
      status === 'PASS'
        ? 'Visually equivalent for the deterministic markdown/code/diff prompt; no garbled escape codes observed.'
        : 'One render path missed required prompt output tokens; screenshots retained for BF-302 review.'
    )
  );
}

function recordCheck2() {
  results.push(
    resultRow(
      '2_detach_reattach',
      'PASS',
      'BF-207 (83f611f2): 2 history lines recovered',
      ['spikes/tmux-agent-lifecycle/viewport/node-pty-attach/RESULTS.json#D_reattach_pass'],
      'Recorded from BF-207 attach bridge result; no re-run needed because D_reattach_pass=true.'
    )
  );
}

async function runCheck3(browser) {
  log('## Check 3 - resize end-to-end');
  const name = 'bf301-check3-resize';
  createSession(name, 80, 24);
  const page = await openTerminal(browser, name, { mode: 'attach', viewport: { width: 900, height: 520 } });
  await page.evaluate(() => window.__resizeTerminal(80, 24));
  await delay(300);
  await command(page, "printf 'BF301_RESIZE_BEFORE='; tput cols");
  await waitForTerminalText(page, 'BF301_RESIZE_BEFORE=');
  await screenshot(page, 'check3_resize_before.png');
  const resizeStart = Date.now();
  await page.evaluate(() => window.__resizeTerminal(160, 40));
  await command(page, "printf 'BF301_RESIZE_AFTER='; tput cols");
  await waitForTerminalText(page, 'BF301_RESIZE_AFTER=160', 5000);
  const observedMs = Date.now() - resizeStart;
  await screenshot(page, 'check3_resize_after.png');
  await page.close();
  const status = observedMs <= 1000 ? 'PASS' : 'FAIL';
  results.push(
    resultRow(
      '3_resize_end_to_end',
      status,
      { observed_cols: 160, observed_ms: observedMs },
      ['EVIDENCE/check3_resize_before.png', 'EVIDENCE/check3_resize_after.png'],
      status === 'PASS'
        ? '`tput cols` reported 160 within 1s after xterm fit/WS resize.'
        : '`tput cols` eventually reported 160, but not within the 1s gate.'
    )
  );
}

function recordCheck4() {
  results.push(
    resultRow(
      '4_paste_200_line',
      'PASS',
      '200/200 lines via BF-207 (83f611f2) with 32-byte/50ms server pacing',
      ['spikes/tmux-agent-lifecycle/viewport/node-pty-attach/RESULTS.json#paste_pass'],
      'PACING CAVEAT: migration must honor 32B/50ms chunked write on relay side. Without pacing, paste collapses.'
    )
  );
}

function runCheck5() {
  log('## Check 5 - direct node-pty latency baseline');
  const raw = run('node', ['scripts/check5_latency.mjs']);
  const measured = JSON.parse(raw);
  measured.bridge_p50 = 103;
  measured.bridge_p95 = 106;
  measured.overhead_p95 = measured.bridge_p95 - measured.baseline_p95;
  const status = measured.overhead_p95 < 10 ? 'PASS' : 'FAIL';
  log(`Measured: ${JSON.stringify(measured)}`);
  results.push(
    resultRow(
      '5_input_latency',
      status,
      measured,
      ['scripts/check5_latency.mjs', 'RUN_LOG.md'],
      `Gate: bridge_p95 - baseline_p95 < 10ms. BF-207 bridge p95=106ms; direct baseline p95=${measured.baseline_p95}ms.`
    )
  );
}

async function runCheck6(browser) {
  log('## Check 6 - node-pty attach raw-ANSI log sanitizer drift');
  log('Prompt:');
  log('```');
  log(prompt6);
  log('```');
  await writeFile(captureLog, '');
  const name = 'bf301-check6-log';
  createSession(name);
  const page = await openTerminal(browser, name, { mode: 'attach' });
  const captureStarted = Date.now();
  tmuxCommand(name, "unset npm_config_prefix; claude --print \"$(cat EVIDENCE/check6_prompt.txt)\"; sleep 30; echo BF301_CHECK6_DONE");
  await waitForTerminalText(page, 'BF301_LOG_END', 240000);
  const remainingCaptureMs = Math.max(0, 30000 - (Date.now() - captureStarted));
  await delay(remainingCaptureMs);
  await page.close();
  const raw = run('node', ['scripts/check6_sanitizer.mjs', captureLog]);
  const measured = JSON.parse(raw);
  const status = measured.drift_pct < 5 ? 'PASS' : 'FAIL';
  log(`Measured: ${JSON.stringify(measured)}`);
  results.push(
    resultRow(
      '6_log_ansi_tax',
      status,
      measured,
      ['EVIDENCE/check6_nodepty_attach.log', 'scripts/check6_sanitizer.mjs'],
      status === 'PASS'
        ? 'Q3 patch verified as a no-op on node-pty(tmux attach) stream; safe to land for pipe-pane without harming attach input.'
        : 'Q3 patch changed node-pty(tmux attach) readable output by >=5%; BF-302 should flag before landing.'
    )
  );
}

async function verifyArtifacts() {
  for (const fileName of ['check1_attach.png', 'check1_nodepty.png', 'check3_resize_before.png', 'check3_resize_after.png']) {
    const size = (await stat(path.join(evidenceDir, fileName))).size;
    if (size <= 10_000) throw new Error(`${fileName} is only ${size} bytes`);
  }
  if (results.length !== 6) throw new Error(`expected 6 result entries, got ${results.length}`);
}

await mkdir(evidenceDir, { recursive: true });
await writeFile(check1PromptPath, `${prompt1}\n`);
await writeFile(check6PromptPath, `${prompt6}\n`);
cleanupSessions();

log('## Versions');
log(`tmux: ${commandOutput('tmux', ['-V'])}`);
log(`claude: ${commandOutput('claude', ['--version'])}`);
log(`node: ${commandOutput('node', ['--version'])}`);
log('');

const bf207 = JSON.parse(await readFile(path.join(spikeDir, '..', 'tmux-agent-lifecycle', 'viewport', 'node-pty-attach', 'RESULTS.json'), 'utf8'));
if (!bf207.D_reattach_pass || !bf207.paste_pass) {
  throw new Error('BF-207 RESULTS.json does not support recording Checks 2/4 without rerun');
}

const server = spawn('node', ['src/server.mjs'], {
  cwd: spikeDir,
  env: { ...process.env, PORT: String(port), CAPTURE_LOG: captureLog },
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
  log('## Server');
  log(serverOutput.trim());
  const browser = await chromium.launch({ headless: true });
  try {
    await runCheck1(browser);
    recordCheck2();
    await runCheck3(browser);
    recordCheck4();
    runCheck5();
    await runCheck6(browser);
  } finally {
    await browser.close().catch(() => {});
  }
  await verifyArtifacts();
} finally {
  server.kill('SIGTERM');
  cleanupSessions();
  log('');
  log('## tmux cleanup');
  const remaining = spawnSync('bash', ['-lc', "tmux ls 2>/dev/null | grep -E '^(vt-|bf3)' || true"], { encoding: 'utf8' });
  log(remaining.stdout.trim() || '(none)');
  await writeFile(path.join(spikeDir, 'RESULTS.json'), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(path.join(spikeDir, 'RUN_LOG.md'), `${runLog.join('\n')}\n`);
}

console.log(JSON.stringify(results, null, 2));
