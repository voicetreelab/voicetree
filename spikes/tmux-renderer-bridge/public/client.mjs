const params = new URLSearchParams(window.location.search);
const session = params.get('name') || params.get('agent') || 'np-BF207';
const mode = params.get('mode') === 'direct' ? 'direct' : 'attach';
const status = document.querySelector('#status');
const label = document.querySelector('#session-label');
label.textContent = `${mode}:${session}`;

const terminal = new window.Terminal({
  cursorBlink: true,
  convertEol: true,
  fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 14,
  lineHeight: 1.15,
  scrollback: 5000,
  theme: {
    background: '#0f1217',
    foreground: '#e5e7eb',
    cursor: '#facc15',
    selectionBackground: '#475569'
  }
});
const fitAddon = new window.FitAddon.FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(document.querySelector('#terminal'));
fitAddon.fit();
terminal.focus();

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(
  `${protocol}//${window.location.host}/${mode}/${encodeURIComponent(session)}?cols=${terminal.cols}&rows=${terminal.rows}${
    params.has('cmd') ? `&cmd=${encodeURIComponent(params.get('cmd'))}` : ''
  }`
);

function sendData(payload) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type: 'data', payload }));
  return true;
}

function sendResize() {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
}

socket.addEventListener('open', () => {
  status.textContent = 'connected';
  sendResize();
});
socket.addEventListener('close', () => {
  status.textContent = 'closed';
});
socket.addEventListener('error', () => {
  status.textContent = 'error';
});
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'data') terminal.write(msg.payload);
  if (msg.type === 'exit') status.textContent = `exit ${msg.code}`;
});

terminal.onData((data) => {
  sendData(data);
});

window.addEventListener('resize', () => {
  fitAddon.fit();
  sendResize();
});

window.__sendTerminalData = sendData;
window.__resizeTerminal = (cols, rows) => {
  terminal.resize(cols, rows);
  sendResize();
};
window.__terminalText = () => {
  const lines = [];
  const buffer = terminal.buffer.active;
  for (let i = 0; i < buffer.length; i += 1) {
    lines.push(buffer.getLine(i)?.translateToString(true) || '');
  }
  return lines.join('\n');
};
