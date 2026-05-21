import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const spikeDir = path.resolve(__dirname, '..');
const publicDir = path.join(spikeDir, 'public');
const port = Number(process.env.PORT || 4278);

const vendorMap = new Map([
  ['/vendor/xterm.js', path.join(spikeDir, 'node_modules/@xterm/xterm/lib/xterm.js')],
  ['/vendor/xterm.css', path.join(spikeDir, 'node_modules/@xterm/xterm/css/xterm.css')],
  ['/vendor/addon-fit.js', path.join(spikeDir, 'node_modules/@xterm/addon-fit/lib/addon-fit.js')],
  ['/vendor/addon-clipboard.js', path.join(spikeDir, 'node_modules/@xterm/addon-clipboard/lib/addon-clipboard.js')],
  ['/vendor/addon-search.js', path.join(spikeDir, 'node_modules/@xterm/addon-search/lib/addon-search.js')],
  ['/vendor/addon-unicode11.js', path.join(spikeDir, 'node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js')],
  ['/vendor/addon-webgl.js', path.join(spikeDir, 'node_modules/@xterm/addon-webgl/lib/addon-webgl.js')]
]);

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

server.listen(port, () => {
  console.log(`BF-208 webapp-integration probe listening on http://127.0.0.1:${port}`);
});
