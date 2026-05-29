import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lifecycleDir = path.resolve(__dirname, '../..');
const viewportDir = path.resolve(__dirname, '..');
const projectDir = process.env.PROJECT_DIR || path.join(viewportDir, '.runtime-project');
const agent = process.env.VIEWPORT_AGENT || process.argv[2] || 'BF203';

spawnSync('bash', [path.join(lifecycleDir, 'kill-agent.sh'), agent], {
  cwd: lifecycleDir,
  env: { ...process.env, PROJECT_DIR: projectDir },
  stdio: 'inherit'
});
