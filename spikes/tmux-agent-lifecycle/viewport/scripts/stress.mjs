import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewportDir = path.resolve(__dirname, '..');
const lifecycleDir = path.resolve(viewportDir, '..');
const evidenceDir = path.join(viewportDir, 'EVIDENCE');
const projectDir = path.join(viewportDir, '.stress-project');
const resultPath = path.join(viewportDir, 'STRESS_RESULTS.json');
const logPath = path.join(viewportDir, 'STRESS_RUN_LOG.md');
const agents = ['BF204-Ada', 'BF204-Ben', 'BF204-Cyd'];
const rex = 'Rex';
const allAgents = [...agents, rex];
const notes = [];
const transcript = [];
const claudeVersion = run('claude', ['--version']).stdout.trim();

const results = {
  multi_C_n3_pass: false,
  multi_C_n10_pass: 'untested',
  multi_C_max_concurrent_observed: 0,
  reattach_D_pass: false,
  reattach_D_history_lines_recovered: 0,
  notes
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || viewportDir,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return result;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasSession(agent) {
  return spawnSync('tmux', ['has-session', '-t', `vt-${agent}`], { stdio: 'ignore' }).status === 0;
}

function capturePane(agent) {
  const result = spawnSync('tmux', ['capture-pane', '-e', '-J', '-p', '-t', `vt-${agent}`, '-S', '-200'], {
    encoding: 'utf8'
  });
  return result.status === 0 ? result.stdout : '';
}

async function killAgent(agent) {
  await new Promise((resolve) => {
    const child = spawn('bash', [path.join(lifecycleDir, 'kill-agent.sh'), agent], {
      cwd: lifecycleDir,
      env: { ...process.env, PROJECT_DIR: projectDir },
      stdio: 'ignore'
    });
    child.on('exit', resolve);
    child.on('error', resolve);
  });
}

async function cleanupAgents() {
  await Promise.all(allAgents.map((agent) => killAgent(agent)));
}

async function waitForPaneText(agent, text, timeout = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (capturePane(agent).includes(text)) return;
    await delay(250);
  }
  throw new Error(`timed out waiting for ${text} in vt-${agent}`);
}

async function waitForPageText(page, text, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (bodyText.includes(text)) return;
    await delay(250);
  }
  throw new Error(`timed out waiting for browser text: ${text}`);
}

async function typeCommand(page, command) {
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText(command);
  await page.keyboard.press('Enter');
}

async function startServer(port) {
  const server = spawn('node', ['src/server.mjs'], {
    cwd: viewportDir,
    env: { ...process.env, PORT: String(port), PROJECT_DIR: projectDir, POLL_MS: '100' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  await new Promise((resolve, reject) => {
    const check = setInterval(() => {
      if (output.includes('listening')) {
        clearInterval(check);
        resolve();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(check);
      reject(new Error(`viewport server did not start on ${port}:\n${output}`));
    }, 10000);
  });
  transcript.push(`Started viewport server on ${port}.`);
  return {
    process: server,
    output: () => output
  };
}

async function stopServer(server) {
  if (!server || server.process.killed) return;
  server.process.kill('SIGTERM');
  await delay(500);
  if (!server.process.killed) server.process.kill('SIGKILL');
}

async function openViewport(context, baseUrl, agent) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?agent=${encodeURIComponent(agent)}`);
  await page.locator('#status').filter({ hasText: 'connected' }).waitFor({ timeout: 10000 });
  await waitForPaneText(agent, 'bash-', 30000);
  await delay(300);
  return page;
}

async function screenshotMultiDashboard(context, baseUrl) {
  const dashboard = await context.newPage();
  await dashboard.setViewportSize({ width: 1720, height: 980 });
  await dashboard.setContent(`<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; background: #111317; color: #f4f7fb; font-family: system-ui, sans-serif; }
      header { padding: 12px 16px; font-size: 18px; font-weight: 650; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 0 10px 10px; height: 910px; }
      iframe { width: 100%; height: 100%; border: 1px solid #596273; }
    </style>
  </head>
  <body>
    <header>BF-204 multi viewport stress: claude ${claudeVersion}</header>
    <section class="grid">
      ${agents.map((agent) => `<iframe src="${baseUrl}/?agent=${encodeURIComponent(agent)}"></iframe>`).join('')}
    </section>
  </body>
</html>`);
  await delay(2500);
  await dashboard.screenshot({ path: path.join(evidenceDir, 'multi-3-viewports.png'), fullPage: true });
  await dashboard.close();
}

async function runMultiStress() {
  const port = 4273;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  try {
    const pages = [];
    for (const agent of agents) pages.push(await openViewport(context, baseUrl, agent));
    results.multi_C_max_concurrent_observed = agents.filter((agent) => hasSession(agent)).length;

    await Promise.all(
      pages.map((page, index) => {
        const label = String.fromCharCode(65 + index);
        const token = `BF204_MULTI_${label}_CLAUDE`;
        const command = [
          'clear',
          `printf 'BF204_MULTI_${label}_START\\n'`,
          'echo "BF204_CLAUDE_VERSION: $(claude --version)"',
          `token=$(printf 'BF204_MULTI_${label}_%s' CLAUDE)`,
          `marker=$(printf 'BF204_MULTI_${label}_%s' DONE)`,
          'claude --print "Reply exactly $token and nothing else."',
          'echo "$marker"'
        ].join('; ');
        return typeCommand(page, command);
      })
    );

    for (let index = 0; index < agents.length; index += 1) {
      const label = String.fromCharCode(65 + index);
      await waitForPaneText(agents[index], `BF204_MULTI_${label}_CLAUDE`);
      await waitForPaneText(agents[index], `BF204_MULTI_${label}_DONE`);
      await waitForPageText(pages[index], `BF204_MULTI_${label}_CLAUDE`);
    }

    const panes = agents.map((agent) => capturePane(agent));
    const noCrossTalk = panes.every((pane, index) =>
      agents.every((_, otherIndex) => {
        const otherLabel = String.fromCharCode(65 + otherIndex);
        return otherIndex === index || !pane.includes(`BF204_MULTI_${otherLabel}_CLAUDE`);
      })
    );
    results.multi_C_n3_pass = results.multi_C_max_concurrent_observed === 3 && noCrossTalk;
    notes.push('N=10 stretch was left untested to keep this spike bounded; N=3 used real concurrent claude --print calls.');
    await screenshotMultiDashboard(context, baseUrl);
    transcript.push(`Multi-session C: n=3 pass=${results.multi_C_n3_pass}; max_concurrent=${results.multi_C_max_concurrent_observed}; no_cross_talk=${noCrossTalk}.`);
  } finally {
    await browser.close().catch(() => {});
    await stopServer(server);
    await cleanupAgents();
  }
}

async function logFileSize(agent) {
  const agentLog = path.join(projectDir, '.voicetree', 'terminals', `${agent}.log`);
  return stat(agentLog).then((info) => info.size).catch(() => 0);
}

async function runReattachStress() {
  const port = 4274;
  const baseUrl = `http://127.0.0.1:${port}`;
  let server = await startServer(port);
  let browser = await chromium.launch({ headless: true });
  let context = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  try {
    const page = await openViewport(context, baseUrl, rex);
    await typeCommand(
      page,
      [
        'clear',
        "echo BF204_REATTACH_BEFORE",
        'echo "BF204_CLAUDE_VERSION: $(claude --version)"',
        "(sleep 2; token=$(printf 'BF204_REX_DISCONNECTED_%s' HISTORY); marker=$(printf 'BF204_REATTACH_AFTER_CLAUDE_%s' DONE); claude --print \"Reply exactly $token and nothing else.\"; echo \"$marker\") &",
        'echo BF204_REATTACH_BACKGROUND_STARTED'
      ].join('; ').replace(') &; echo', ') & echo')
    );
    await waitForPaneText(rex, 'BF204_REATTACH_BACKGROUND_STARTED');
    await waitForPageText(page, 'BF204_REATTACH_BACKGROUND_STARTED');
    await page.screenshot({ path: path.join(evidenceDir, 'reattach-before.png'), fullPage: true });

    const sizeBeforeDisconnect = await logFileSize(rex);
    await browser.close();
    await stopServer(server);
    server = null;
    transcript.push('Killed browser and viewport server while vt-Rex background claude command continued.');

    const aliveDuringDisconnect = hasSession(rex);
    await waitForPaneText(rex, 'BF204_REX_DISCONNECTED_HISTORY', 180000);
    await waitForPaneText(rex, 'BF204_REATTACH_AFTER_CLAUDE_DONE', 180000);
    const sizeAfterDisconnect = await logFileSize(rex);

    server = await startServer(port);
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
    const reattached = await openViewport(context, baseUrl, rex);
    await waitForPaneText(rex, 'BF204_REX_DISCONNECTED_HISTORY');
    await delay(1500);
    await reattached.screenshot({ path: path.join(evidenceDir, 'reattach-after.png'), fullPage: true });

    const reattachedPane = capturePane(rex);
    const recovered = ['BF204_REX_DISCONNECTED_HISTORY', 'BF204_REATTACH_AFTER_CLAUDE_DONE'].filter((line) =>
      reattachedPane.includes(line)
    ).length;
    results.reattach_D_history_lines_recovered = recovered;
    results.reattach_D_pass = aliveDuringDisconnect && sizeAfterDisconnect > sizeBeforeDisconnect && recovered >= 1;
    transcript.push(`Reattach D: pass=${results.reattach_D_pass}; alive_during_disconnect=${aliveDuringDisconnect}; log_bytes_before=${sizeBeforeDisconnect}; log_bytes_after=${sizeAfterDisconnect}; recovered_lines=${recovered}.`);
  } finally {
    await browser.close().catch(() => {});
    await stopServer(server);
    await cleanupAgents();
  }
}

async function writeOutputs() {
  const cleanupProbe = spawnSync('bash', ['-lc', "tmux list-sessions 2>/dev/null | grep -E '^(vt-|bf204)' || true"], {
    encoding: 'utf8'
  }).stdout.trim();
  if (cleanupProbe) notes.push(`cleanup probe still found sessions: ${cleanupProbe}`);
  else notes.push("cleanup probe empty for grep -E '^(vt-|bf204)' after run.");

  await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(
    logPath,
    `# BF-204 stress run log

## Environment
- Timestamp: ${new Date().toISOString()}
- claude: ${claudeVersion}
- tmux: ${run('tmux', ['-V']).stdout.trim()}
- Node: ${process.version}
- Project: ${path.relative(viewportDir, projectDir)}

## Results
- multi_C_n3_pass: ${results.multi_C_n3_pass}
- multi_C_n10_pass: ${results.multi_C_n10_pass}
- multi_C_max_concurrent_observed: ${results.multi_C_max_concurrent_observed}
- reattach_D_pass: ${results.reattach_D_pass}
- reattach_D_history_lines_recovered: ${results.reattach_D_history_lines_recovered}

## Evidence
- EVIDENCE/multi-3-viewports.png
- EVIDENCE/reattach-before.png
- EVIDENCE/reattach-after.png

## Transcript
${transcript.map((line) => `- ${line}`).join('\n')}

## Notes
${notes.map((line) => `- ${line}`).join('\n')}
`
  );
}

try {
  await mkdir(evidenceDir, { recursive: true });
  await cleanupAgents();
  await rm(projectDir, { recursive: true, force: true });
  await mkdir(projectDir, { recursive: true });
  await runMultiStress();
  await runReattachStress();
  await writeOutputs();
  if (!results.multi_C_n3_pass || !results.reattach_D_pass) process.exitCode = 1;
} catch (error) {
  notes.push(`fatal: ${error.message}`);
  transcript.push(`Fatal error: ${error.stack || error.message}`);
  await cleanupAgents();
  await writeOutputs().catch(() => {});
  throw error;
}
