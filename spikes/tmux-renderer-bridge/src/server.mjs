import { createServer } from 'node:http';
import { appendFileSync, createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';
import { WebSocket, WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const spikeDir = path.resolve(__dirname, '..');
const publicDir = path.join(spikeDir, 'public');
const port = Number(process.env.PORT || 4277);

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
    ['/vendor/xterm.js', path.join(spikeDir, 'node_modules/@xterm/xterm/lib/xterm.js')],
    ['/vendor/xterm.css', path.join(spikeDir, 'node_modules/@xterm/xterm/css/xterm.css')],
    ['/vendor/fit.js', path.join(spikeDir, 'node_modules/@xterm/addon-fit/lib/addon-fit.js')]
  ]);
  const mappedVendor = vendorMap.get(url.pathname);
  const filePath = mappedVendor || path.join(publicDir, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!mappedVendor && !filePath.startsWith(publicDir)) {
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
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

const wss = new WebSocketServer({ noServer: true });

function writeCapture(payload) {
  if (!process.env.CAPTURE_LOG) return;
  appendFileSync(process.env.CAPTURE_LOG, payload);
}

function attachProcess(ws, req, mode) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const name = decodeURIComponent(url.pathname.replace(/^\/(?:attach|direct)\//, ''));
  const cols = Number(url.searchParams.get('cols') || 120);
  const rows = Number(url.searchParams.get('rows') || 40);
  const directCommand = mode === 'direct' ? url.searchParams.get('cmd') : null;
  let term;
  try {
    const command = mode === 'tmux' ? 'tmux' : directCommand ? '/bin/bash' : process.env.SHELL || 'zsh';
    const args = mode === 'tmux' ? ['attach', '-t', name] : directCommand ? ['-lc', directCommand] : ['-l'];
    const env = {
      ...process.env,
      PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: process.env.HOME || process.cwd(),
      TERM: 'xterm-256color',
      LANG: process.env.LANG || 'en_US.UTF-8'
    };
    delete env.npm_config_prefix;
    term = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.cwd(),
      env
    });
  } catch (error) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', payload: `node-pty spawn failed: ${error.message}\r\n` }));
      ws.send(JSON.stringify({ type: 'exit', code: 1 }));
    }
    ws.close();
    return;
  }

  const pendingWrites = [];
  let flushingWrites = false;
  const flushWrites = () => {
    if (flushingWrites) return;
    flushingWrites = true;
    const flushNext = () => {
      const chunk = pendingWrites.shift();
      if (!chunk) {
        flushingWrites = false;
        return;
      }
      term.write(chunk);
      setTimeout(flushNext, 50);
    };
    flushNext();
  };
  const writeToPty = (payload) => {
    const text = payload || '';
    for (let offset = 0; offset < text.length; offset += 32) {
      pendingWrites.push(text.slice(offset, offset + 32));
    }
    flushWrites();
  };

  term.onData((payload) => {
    writeCapture(payload);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', payload }));
  });
  term.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    ws.close();
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'data') writeToPty(msg.payload);
    if (msg.type === 'resize') {
      const nextCols = Number(msg.cols);
      const nextRows = Number(msg.rows);
      if (Number.isFinite(nextCols) && Number.isFinite(nextRows) && nextCols > 0 && nextRows > 0) {
        term.resize(nextCols, nextRows);
      }
    }
  });
  ws.on('close', () => term.kill());
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const isAttach = url.pathname.startsWith('/attach/');
  const isDirect = url.pathname.startsWith('/direct/');
  if (!isAttach && !isDirect) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => attachProcess(ws, req, isAttach ? 'tmux' : 'direct'));
});

server.listen(port, () => {
  console.log(`BF-301 renderer bridge listening on http://127.0.0.1:${port}`);
});
