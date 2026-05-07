import { execSync } from 'child_process';
import { join } from 'path';

const SYSTEM_PACKAGES = new Set([
  '@vt/graph-db-server',
  '@vt/agent-runtime',
  '@vt/voicetree-mcp',
  '@vt/graph-db-client',
]);

const SYMBOL_WARN = 15;
const SYMBOL_FAIL = 15;

const root = join(import.meta.dirname, '..');

function grepImports(dirs) {
  try {
    return execSync(
      `grep -rh --include='*.ts' --include='*.tsx' -e 'from .@vt/' ${dirs}`,
      { encoding: 'utf8', cwd: root }
    );
  } catch (e) {
    if (e.status === 1) return '';
    throw e;
  }
}

const raw = grepImports('packages/libraries/ packages/systems/ webapp/src/');
const lines = raw.split('\n').filter(Boolean);

const systemSymbols = new Map();

for (const line of lines) {
  const match = line.match(/from ['"](@vt\/[^/]+)(\/.+)?['"]/);
  if (!match) continue;
  const [, pkg] = match;
  if (!SYSTEM_PACKAGES.has(pkg)) continue;

  const symbolMatch = line.match(/import\s*\{([^}]*)\}/);
  if (!symbolMatch) continue;

  const symbols = symbolMatch[1]
    .split(',')
    .map(s => s.trim().replace(/^type /, ''))
    .filter(Boolean);

  if (!systemSymbols.has(pkg)) systemSymbols.set(pkg, new Set());
  for (const sym of symbols) systemSymbols.get(pkg).add(sym);
}

console.log('System package coupling report (symbol fan-in from consumers):\n');
let failures = 0;
for (const [pkg, syms] of [...systemSymbols].sort((a, b) => b[1].size - a[1].size)) {
  const count = syms.size;
  const flag = count > SYMBOL_WARN ? ' ⚠️' : '';
  console.log(`${pkg}: ${count} symbols imported by consumers${flag}`);
  if (count > SYMBOL_WARN) {
    const sorted = [...syms].sort();
    console.log(`  top symbols: ${sorted.slice(0, 8).join(', ')}${sorted.length > 8 ? ', ...' : ''}`);
  }
  if (SYMBOL_FAIL > 0 && count > SYMBOL_FAIL) failures++;
}

for (const pkg of SYSTEM_PACKAGES) {
  if (!systemSymbols.has(pkg)) console.log(`${pkg}: 0 symbols imported by consumers`);
}

if (failures) {
  console.error(`\n✗ ${failures} system package(s) exceed symbol fan-in threshold (${SYMBOL_FAIL})`);
  process.exit(1);
}

console.log(`\n✓ All system packages within symbol fan-in threshold (${SYMBOL_FAIL})`);
