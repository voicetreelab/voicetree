import { spawnSync } from 'node:child_process';

const list = spawnSync('tmux', ['ls'], { encoding: 'utf8' });
if (list.status !== 0) process.exit(0);

for (const line of list.stdout.split('\n')) {
  const match = line.match(/^(pp-[^:]+):/);
  if (match) spawnSync('tmux', ['kill-session', '-t', match[1]], { stdio: 'ignore' });
}
