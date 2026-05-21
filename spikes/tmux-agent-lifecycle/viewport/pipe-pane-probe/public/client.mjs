const params = new URLSearchParams(window.location.search);
const agent = params.get('agent') || 'Smoke';
const command = params.get('command') || 'bash';
const status = document.querySelector('#status');
const label = document.querySelector('#session-label');
label.textContent = `pp-${agent}`;

const terminal = new window.Terminal({
  cursorBlink: true,
  convertEol: true,
  fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 14,
  lineHeight: 1.15,
  scrollback: 5000,
  theme: {
    background: '#101214',
    foreground: '#eceff4',
    cursor: '#f5c542',
    selectionBackground: '#3d5368'
  }
});
const fitAddon = new window.FitAddon.FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(document.querySelector('#terminal'));
fitAddon.fit();
terminal.focus();

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(
  `${protocol}//${window.location.host}/terminal?agent=${encodeURIComponent(agent)}&command=${encodeURIComponent(command)}`
);

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
  if (msg.type === 'chunk') terminal.write(msg.data);
});

terminal.onData((data) => {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'input', data }));
});

window.addEventListener('resize', () => {
  fitAddon.fit();
  sendResize();
});
