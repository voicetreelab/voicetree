import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewportDir = path.resolve(__dirname, '..');
const lifecycleDir = path.resolve(viewportDir, '..');
const publicDir = path.join(viewportDir, 'public');
const projectDir = process.env.PROJECT_DIR || path.join(viewportDir, '.runtime-project');
const defaultAgent = process.env.VIEWPORT_AGENT || 'BF203';
const port = Number(process.env.PORT || 4173);
const pollMs = Number(process.env.POLL_MS || 100);
const metrics = {
  startedAt: new Date().toISOString(),
  lastInputAt: null,
  lastFrameAt: null,
  firstFrameAfterInputMs: null,
  frameCount: 0
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || lifecycleDir,
    env: { ...process.env, PROJECT_DIR: projectDir, ...(options.env || {}) },
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const message = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${message}`);
  }
  return result.stdout.trim();
}

function hasSession(agentName) {
  return spawnSync('tmux', ['has-session', '-t', `vt-${agentName}`], { stdio: 'ignore' }).status === 0;
}

function spawnAgent(agentName, prompt = '') {
  if (hasSession(agentName)) return `reused ${agentName}`;
  const args = [path.join(lifecycleDir, 'spawn-agent.sh'), agentName];
  if (prompt) args.push(prompt);
  return run('bash', args);
}

function killAgent(agentName) {
  return run('bash', [path.join(lifecycleDir, 'kill-agent.sh'), agentName]);
}

function capturePane(agentName) {
  const result = spawnSync(
    'tmux',
    ['capture-pane', '-e', '-J', '-p', '-t', `vt-${agentName}`, '-S', '-200'],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    return `tmux session not available: vt-${agentName}\r\n${result.stderr || ''}`;
  }
  return `${result.stdout.replace(/[ \t\r\n]+$/g, '')}\r\n`;
}

function resizePane(agentName, cols, rows) {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
  spawnSync('tmux', ['resize-pane', '-t', `vt-${agentName}`, '-x', String(cols), '-y', String(rows)]);
}

function sendKeys(agentName, data) {
  const session = `vt-${agentName}`;
  const chunks = [];
  let literal = '';
  const flushLiteral = () => {
    if (!literal) return;
    chunks.push(['send-keys', '-t', session, '-l', '--', literal]);
    literal = '';
  };

  for (let i = 0; i < data.length; i += 1) {
    const char = data[i];
    if (char === '\r' || char === '\n') {
      flushLiteral();
      chunks.push(['send-keys', '-t', session, 'C-m']);
    } else if (char === '\u007f') {
      flushLiteral();
      chunks.push(['send-keys', '-t', session, 'BSpace']);
    } else if (char === '\u0003') {
      flushLiteral();
      chunks.push(['send-keys', '-t', session, 'C-c']);
    } else if (char === '\u0015') {
      flushLiteral();
      chunks.push(['send-keys', '-t', session, 'C-u']);
    } else if (char === '\u001b' && data.slice(i, i + 3) === '\u001b[A') {
      flushLiteral();
      chunks.push(['send-keys', '-t', session, 'Up']);
      i += 2;
    } else {
      literal += char;
    }
  }
  flushLiteral();

  metrics.lastInputAt = Date.now();
  metrics.firstFrameAfterInputMs = null;
  for (const args of chunks) {
    spawnSync('tmux', args);
  }
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.mjs') || filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/') {
    const index = await readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(index);
    return;
  }

  const vendorMap = new Map([
    ['/vendor/xterm.js', path.join(viewportDir, 'node_modules/@xterm/xterm/lib/xterm.js')],
    ['/vendor/xterm.css', path.join(viewportDir, 'node_modules/@xterm/xterm/css/xterm.css')],
    ['/vendor/fit.js', path.join(viewportDir, 'node_modules/@xterm/addon-fit/lib/addon-fit.js')]
  ]);
  const mappedVendor = vendorMap.get(url.pathname);
  const filePath = mappedVendor || path.join(publicDir, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(publicDir) && !mappedVendor) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': contentType(filePath) });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'POST' && url.pathname === '/api/spawn') {
      const agent = url.searchParams.get('agent') || defaultAgent;
      const prompt = url.searchParams.get('prompt') || '';
      const result = spawnAgent(agent, prompt);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result, agent, session: `vt-${agent}` }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/kill') {
      const agent = url.searchParams.get('agent') || defaultAgent;
      const result = killAgent(agent);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result, agent }));
      return;
    }
    if (url.pathname === '/api/metrics') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(metrics));
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

const wss = new WebSocketServer({ server, path: '/terminal' });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const agent = url.searchParams.get('agent') || defaultAgent;
  let lastFrame = '';

  spawnAgent(agent);
  const poll = setInterval(() => {
    const frame = capturePane(agent);
    if (frame === lastFrame) return;
    lastFrame = frame;
    const now = Date.now();
    metrics.lastFrameAt = now;
    metrics.frameCount += 1;
    if (metrics.lastInputAt && metrics.firstFrameAfterInputMs === null) {
      metrics.firstFrameAfterInputMs = now - metrics.lastInputAt;
    }
    ws.send(JSON.stringify({ type: 'frame', data: `\x1b[H\x1b[2J${frame}` }));
  }, pollMs);

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'input') sendKeys(agent, msg.data);
    if (msg.type === 'resize') resizePane(agent, msg.cols, msg.rows);
  });
  ws.on('close', () => clearInterval(poll));
});

server.listen(port, () => {
  console.log(`BF-203 tmux viewport listening on http://127.0.0.1:${port}`);
  console.log(`Default agent: ${defaultAgent}; project: ${projectDir}`);
});
