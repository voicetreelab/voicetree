import pty from 'node-pty';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted, p) {
  return sorted[Math.floor(sorted.length * p)];
}

const term = pty.spawn('/bin/bash', ['-lc', 'stty -echo; printf "BF301_BASELINE_READY\\n"; while IFS= read -r line; do printf "%s\\n" "$line"; done'], {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd: process.cwd(),
  env: {
    ...process.env,
    TERM: 'xterm-256color'
  }
});

let buffer = '';
term.onData((chunk) => {
  buffer += chunk;
});

async function waitFor(text, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (buffer.includes(text)) return;
    await delay(5);
  }
  throw new Error(`timed out waiting for ${text}`);
}

await waitFor('BF301_BASELINE_READY');

const samples = [];
for (let i = 0; i < 100; i += 1) {
  const token = `BF301_BASELINE_${String(i).padStart(3, '0')}`;
  const start = Date.now();
  term.write(`${token}\r`);
  await waitFor(token);
  samples.push(Date.now() - start);
  await delay(5);
}

term.kill();
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    baseline_p50: percentile(samples, 0.5),
    baseline_p95: percentile(samples, 0.95),
    n: samples.length,
    samples
  })
);
