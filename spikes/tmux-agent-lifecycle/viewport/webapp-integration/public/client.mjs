/**
 * BF-208 integration probe: replicates webapp/src/.../TerminalVanilla.ts xterm config
 * but swaps the electronAPI.terminal IPC data source for BF-207's WebSocket bridge.
 *
 * The webapp's data-source contract surface is:
 *   - electronAPI.terminal.write(id, data)                  (terminal -> backend bytes)
 *   - electronAPI.terminal.resize(id, cols, rows)           (terminal -> backend resize)
 *   - electronAPI.terminal.onData(cb(id, data))             (backend -> terminal bytes)
 *   - electronAPI.terminal.onExit(cb(id, code))             (backend -> terminal exit)
 *   - electronAPI.terminal.spawn(terminalData)              (creates backend terminal)
 *
 * BF-207's WS protocol (from spike-tmux-renderer-bridge/design.md):
 *   - send {type:'data', payload}                           (terminal -> backend bytes)
 *   - send {type:'resize', cols, rows}                      (terminal -> backend resize)
 *   - recv {type:'data', payload}                           (backend -> terminal bytes)
 *   - recv {type:'exit', code}                              (backend -> terminal exit)
 *   - "spawn" is replaced by `tmux new-session -d -s name`  before WS connect
 *
 * The shapes line up trivially — the probe is the proof.
 */

const params = new URLSearchParams(window.location.search);
const session = params.get('name') || params.get('agent') || 'wi-Q1';
const bridgeHost = params.get('bridge') || '127.0.0.1:4277'; // BF-207 default port

const statusEl = document.querySelector('#status');
const labelEl = document.querySelector('#session-label');
const addonStatusEl = document.querySelector('#addon-status');
labelEl.textContent = session;

// ─── Match TerminalVanilla.ts XTerm config exactly ─────────────────────────────
const term = new window.Terminal({
  cursorBlink: true,
  scrollback: 10000,
  scrollOnEraseInDisplay: true,
  scrollOnUserInput: true,
  fontSize: 14,
  allowProposedApi: true, // Required for Unicode11Addon
  theme: {
    background: '#0f1217',
    foreground: '#e5e7eb',
    cursor: '#facc15',
    selectionBackground: '#475569'
  }
});

const addonStatus = [];

const fitAddon = new window.FitAddon.FitAddon();
term.loadAddon(fitAddon);
addonStatus.push('fit');

term.open(document.querySelector('#terminal'));

// WebGL addon — webapp loads conditionally under a context-count cap.
// We honour the same try/catch shape so addon-init failure stays survivable.
let webglOk = false;
try {
  const webglAddon = new window.WebglAddon.WebglAddon();
  term.loadAddon(webglAddon);
  webglAddon.onContextLoss(() => {
    console.warn('WebGL context lost, fallback to DOM renderer');
    webglAddon.dispose();
  });
  webglOk = true;
  addonStatus.push('webgl');
} catch (e) {
  console.warn('WebGL2 not supported, using DOM renderer:', e);
  addonStatus.push('webgl(disabled)');
}

const clipboardAddon = new window.ClipboardAddon.ClipboardAddon();
term.loadAddon(clipboardAddon);
addonStatus.push('clipboard');

const searchAddon = new window.SearchAddon.SearchAddon();
term.loadAddon(searchAddon);
addonStatus.push('search');

const unicode11Addon = new window.Unicode11Addon.Unicode11Addon();
term.loadAddon(unicode11Addon);
term.unicode.activeVersion = '11';
addonStatus.push('unicode11');

addonStatusEl.textContent = 'addons: ' + addonStatus.join(', ');

fitAddon.fit();
term.focus();

// ─── Data source: BF-207 WS (replaces electronAPI.terminal IPC) ────────────────
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(
  `${protocol}//${bridgeHost}/attach/${encodeURIComponent(session)}?cols=${term.cols}&rows=${term.rows}`
);

function sendData(payload) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type: 'data', payload }));
  return true;
}

function sendResize() {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
}

socket.addEventListener('open', () => {
  statusEl.textContent = 'connected';
  sendResize();
});
socket.addEventListener('close', () => { statusEl.textContent = 'closed'; });
socket.addEventListener('error', () => { statusEl.textContent = 'error'; });
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'data') term.write(msg.payload);
  if (msg.type === 'exit') statusEl.textContent = `exit ${msg.code}`;
});

// ─── Webapp's Shift+Enter handler (verbatim semantics) ─────────────────────────
let suppressNextEnter = false;
term.attachCustomKeyEventHandler((event) => {
  if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey
      && !event.metaKey && !event.ctrlKey && !event.altKey) {
    sendData('\x1b\r');
    suppressNextEnter = true;
    return false;
  }
  return true;
});

term.onData((data) => {
  if (suppressNextEnter && data === '\r') {
    suppressNextEnter = false;
    return;
  }
  suppressNextEnter = false;
  sendData(data);
});

term.onResize(({ cols, rows }) => { sendResize(); });

const resizeObserver = new ResizeObserver(() => fitAddon.fit());
resizeObserver.observe(document.querySelector('#terminal'));

// Test hooks for the playwright capture script
window.__sendTerminalData = sendData;
window.__resizeTerminal = (cols, rows) => { term.resize(cols, rows); sendResize(); };
window.__terminalText = () => {
  const lines = [];
  const buffer = term.buffer.active;
  for (let i = 0; i < buffer.length; i += 1) {
    lines.push(buffer.getLine(i)?.translateToString(true) || '');
  }
  return lines.join('\n');
};
window.__addonStatus = () => addonStatus;
window.__webglEnabled = () => webglOk;
window.__scrollToBottom = () => term.scrollToBottom();
