import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync, watchFile, unwatchFile } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const probeDir = __dirname;
const viewportDir = path.resolve(probeDir, '..');
const publicDir = path.join(probeDir, 'public');
const streamDir = path.join(probeDir, '.runtime-streams');
const defaultAgent = process.env.PIPE_PANE_AGENT || 'Smoke';
const port = Number(process.env.PORT || 4176);
const metrics = {
  startedAt: new Date().toISOString(),
  sessions: {},
  lastInputAt: null,
  chunkCount: 0,
  byteCount: 0
};

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function sessionName(agent) {
  return `pp-${agent}`;
}

function runTmux(args, options = {}) {
  const result = spawnSync('tmux', args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`tmux ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function hasSession(agent) {
  return spawnSync('tmux', ['has-session', '-t', sessionName(agent)], { stdio: 'ignore' }).status === 0;
}

async function spawnSession(agent, command = 'bash') {
  await mkdir(streamDir, { recursive: true });
  const streamPath = path.join(streamDir, `${agent}.stream.log`);
  await writeFile(streamPath, '');
  if (!hasSession(agent)) {
    runTmux(['new-session', '-d', '-s', sessionName(agent), '-x', '200', '-y', '50', command]);
  }
  runTmux(['pipe-pane', '-t', sessionName(agent), '-O', `cat > ${shellQuote(streamPath)}`]);
  metrics.sessions[agent] = {
    session: sessionName(agent),
    command,
    streamPath,
    spawnedAt: new Date().toISOString()
  };
  return metrics.sessions[agent];
}

function killSession(agent) {
  if (!hasSession(agent)) return `not running: ${sessionName(agent)}`;
  runTmux(['kill-session', '-t', sessionName(agent)]);
  return `killed ${sessionName(agent)}`;
}

function resizePane(agent, cols, rows) {
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || !hasSession(agent)) return;
  spawnSync('tmux', ['resize-pane', '-t', sessionName(agent), '-x', String(cols), '-y', String(rows)]);
}

function sendKeys(agent, data) {
  if (!hasSession(agent)) return;
  const chunks = [];
  let literal = '';
  const flushLiteral = () => {
    if (!literal) return;
    chunks.push(['send-keys', '-t', sessionName(agent), '-l', '--', literal]);
    literal = '';
  };

  for (let i = 0; i < data.length; i += 1) {
    const char = data[i];
    if (char === '\r' || char === '\n') {
      flushLiteral();
      chunks.push(['send-keys', '-t', sessionName(agent), 'C-m']);
    } else if (char === '\u007f') {
      flushLiteral();
      chunks.push(['send-keys', '-t', sessionName(agent), 'BSpace']);
    } else if (char === '\u0003') {
      flushLiteral();
      chunks.push(['send-keys', '-t', sessionName(agent), 'C-c']);
    } else if (char === '\u0015') {
      flushLiteral();
      chunks.push(['send-keys', '-t', sessionName(agent), 'C-u']);
    } else {
      literal += char;
    }
  }
  flushLiteral();

  metrics.lastInputAt = Date.now();
  for (const args of chunks) spawnSync('tmux', args);
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

function tailStreamFile(streamPath, onChunk) {
  let offset = existsSync(streamPath) ? statSync(streamPath).size : 0;
  const readNewBytes = () => {
    if (!existsSync(streamPath)) return;
    const size = statSync(streamPath).size;
    if (size < offset) offset = 0;
    if (size === offset) return;
    const stream = createReadStream(streamPath, { start: offset, end: size - 1 });
    offset = size;
    stream.on('data', (chunk) => onChunk(chunk));
  };
  watchFile(streamPath, { interval: 50 }, readNewBytes);
  return () => unwatchFile(streamPath, readNewBytes);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'POST' && url.pathname === '/api/spawn') {
      const agent = url.searchParams.get('agent') || defaultAgent;
      const command = url.searchParams.get('command') || 'bash';
      const session = await spawnSession(agent, command);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...session }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/kill') {
      const agent = url.searchParams.get('agent') || defaultAgent;
      const result = killSession(agent);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result, agent }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/input') {
      const agent = url.searchParams.get('agent') || defaultAgent;
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const msg = body ? JSON.parse(body) : { data: '' };
        sendKeys(agent, msg.data || '');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, bytes: Buffer.byteLength(msg.data || '') }));
      });
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
wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const agent = url.searchParams.get('agent') || defaultAgent;
  const command = url.searchParams.get('command') || 'bash';
  const session = await spawnSession(agent, command);
  let cleanup = () => {};

  cleanup = tailStreamFile(session.streamPath, (chunk) => {
    metrics.chunkCount += 1;
    metrics.byteCount += chunk.length;
    ws.send(JSON.stringify({ type: 'chunk', data: chunk.toString('utf8') }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'input') sendKeys(agent, msg.data);
    if (msg.type === 'resize') resizePane(agent, msg.cols, msg.rows);
  });
  ws.on('close', cleanup);
});

server.listen(port, () => {
  console.log(`BF-206 pipe-pane probe listening on http://127.0.0.1:${port}`);
  console.log(`Default session: ${sessionName(defaultAgent)}; streams: ${streamDir}`);
});
