import { execSync } from 'child_process';
import { join } from 'path';

// ─── Configuration ───────────────────────────────────────────────────────────

const SYSTEM_PACKAGES = new Set([
  '@vt/graph-db-server',
  '@vt/agent-runtime',
  '@vt/vt-daemon',
  '@vt/graph-db-client',
]);

const LIBRARY_DIRS = ['packages/libraries/'];
const SYSTEM_DIRS = ['packages/systems/'];
const APP_DIRS = ['webapp/src/'];
const ALL_DIRS = [...LIBRARY_DIRS, ...SYSTEM_DIRS, ...APP_DIRS];

// Daemon packages should reach 0 runtime imports (consumers use HTTP/RPC client).
// Embedded packages can't reach 0 — they need a thin API.
const PACKAGE_TARGETS = {
  '@vt/graph-db-server': { target: 0, kind: 'daemon', note: 'use @vt/graph-db-client' },
  '@vt/agent-runtime':   { target: 15, kind: 'embedded', note: 'thin API' },
  '@vt/vt-daemon':   { target: 15, kind: 'embedded', note: 'thin API' },
  '@vt/graph-db-client':  { target: 15, kind: 'client', note: 'consumer-facing' },
};

const root = join(import.meta.dirname, '..');

// ─── Grep helpers ────────────────────────────────────────────────────────────

function grepImports(dirs) {
  try {
    return execSync(
      `grep -rn --include='*.ts' --include='*.tsx' -e 'from .@vt/' ${dirs.join(' ')}`,
      { encoding: 'utf8', cwd: root }
    );
  } catch (e) {
    if (e.status === 1) return '';
    throw e;
  }
}

// ─── Classify a file path ────────────────────────────────────────────────────

function classifyFile(filePath) {
  if (/\.test\.|\.spec\.|__tests__|integration-tests|test-helpers/.test(filePath)) return 'test';
  return 'production';
}

function classifyLayer(filePath) {
  if (LIBRARY_DIRS.some(d => filePath.startsWith(d))) return 'library';
  if (SYSTEM_DIRS.some(d => filePath.startsWith(d))) return 'system';
  if (APP_DIRS.some(d => filePath.startsWith(d))) return 'app';
  return 'unknown';
}

function ownerPackage(filePath) {
  const m = filePath.match(/^packages\/(?:libraries|systems)\/([^/]+)/);
  return m ? `@vt/${m[1]}` : filePath.startsWith('webapp/') ? 'webapp' : null;
}

// ─── Parse all imports ───────────────────────────────────────────────────────

const raw = grepImports(ALL_DIRS);
const lines = raw.split('\n').filter(Boolean);

// symbol → { pkg, files: Set<string>, isRuntime: boolean }
const allSymbols = [];

for (const line of lines) {
  if (line.includes('node_modules') || line.includes('.worktrees')) continue;

  const pkgMatch = line.match(/from ['"](@vt\/[^/'"]+)/);
  if (!pkgMatch) continue;
  const pkg = pkgMatch[1];
  if (!SYSTEM_PACKAGES.has(pkg)) continue;

  const fileMatch = line.match(/^(.+?):\d+:/);
  const file = fileMatch ? fileMatch[1] : '(unknown)';

  // Skip self-imports (package importing from itself)
  const owner = ownerPackage(file);
  if (owner === pkg) continue;

  const isTypeImport = /import\s+type\s*\{/.test(line);

  const symbolMatch = line.match(/import\s+(?:type\s+)?\{([^}]*)\}/);
  if (!symbolMatch) continue;

  const rawSymbols = symbolMatch[1].split(',').map(s => s.trim()).filter(Boolean);

  for (const rawSym of rawSymbols) {
    const cleaned = rawSym.replace(/\s+as\s+.*/, '').trim();
    const isInlineType = cleaned.startsWith('type ');
    const name = cleaned.replace(/^type\s+/, '');
    if (!name) continue;

    const isType = isTypeImport || isInlineType;

    allSymbols.push({ pkg, symbol: name, file, isType });
  }
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

// Per-package → per-symbol → { files, testFiles, prodFiles, layers }
const pkgData = new Map();

for (const { pkg, symbol, file, isType } of allSymbols) {
  if (!pkgData.has(pkg)) pkgData.set(pkg, { runtime: new Map(), typeOnly: new Set(), crossLayer: [] });
  const pd = pkgData.get(pkg);

  if (isType) {
    pd.typeOnly.add(symbol);
    continue;
  }

  if (!pd.runtime.has(symbol)) pd.runtime.set(symbol, { files: new Set(), testFiles: new Set(), prodFiles: new Set() });
  const sd = pd.runtime.get(symbol);
  sd.files.add(file);
  if (classifyFile(file) === 'test') sd.testFiles.add(file);
  else sd.prodFiles.add(file);

  // Cross-layer check: library importing from system = architectural violation
  const consumerLayer = classifyLayer(file);
  if (consumerLayer === 'library') {
    pd.crossLayer.push({ symbol, file, consumerLayer, violation: 'library→system' });
  }
}

// ─── Output ──────────────────────────────────────────────────────────────────

const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const showFiles = process.argv.includes('--files');

console.log('═══════════════════════════════════════════════════════════');
console.log(' RUNTIME vs TYPE coupling to system packages');
console.log('═══════════════════════════════════════════════════════════\n');

let totalRuntime = 0;
let totalType = 0;
let totalProdOnly = 0;
let totalTestOnly = 0;
let totalCrossLayer = 0;
let failures = 0;

for (const pkg of [...SYSTEM_PACKAGES].sort()) {
  const pd = pkgData.get(pkg);
  if (!pd) {
    console.log(`${pkg}: 0 runtime + 0 type-only\n`);
    continue;
  }

  const rtCount = pd.runtime.size;
  const typeCount = pd.typeOnly.size;
  const target = PACKAGE_TARGETS[pkg];

  totalRuntime += rtCount;
  totalType += typeCount;

  // Count 1-file symbols, test-only symbols, prod-only symbols
  let oneFileCount = 0;
  let testOnlyCount = 0;
  let prodOnlyRt = 0;
  for (const [, sd] of pd.runtime) {
    if (sd.files.size === 1) oneFileCount++;
    if (sd.prodFiles.size === 0 && sd.testFiles.size > 0) testOnlyCount++;
    if (sd.prodFiles.size > 0) prodOnlyRt++;
  }
  totalTestOnly += testOnlyCount;
  totalProdOnly += prodOnlyRt;

  const overTarget = target && rtCount > target.target;
  if (overTarget) failures++;

  const statusIcon = overTarget ? '⚠️ ' : '✓ ';
  const targetStr = target ? ` (target: ${target.target} ${target.kind})` : '';
  const prodCount = rtCount - testOnlyCount;

  console.log(`${statusIcon}${pkg}: ${rtCount} runtime (${prodCount} prod + ${testOnlyCount} test-only) + ${typeCount} type-only${targetStr}`);
  if (testOnlyCount > 0) {
    console.log(`  ↳ ${testOnlyCount} test-only symbols = test debt (no prod justification for being public)`);
  }

  // Cross-layer violations
  if (pd.crossLayer.length > 0) {
    totalCrossLayer += pd.crossLayer.length;
    console.log(`  🚫 CROSS-LAYER VIOLATIONS (${pd.crossLayer.length}):`);
    for (const v of pd.crossLayer) {
      console.log(`    ${v.violation}: ${v.file} imports ${v.symbol}`);
    }
  }

  // Symbol list (sorted by prod file count desc)
  if (rtCount > 0) {
    const sorted = [...pd.runtime.entries()].sort((a, b) => b[1].prodFiles.size - a[1].prodFiles.size);

    // Breakdown: 1-file symbols
    console.log(`  ${oneFileCount}/${rtCount} symbols consumed by only 1 file (internalization candidates)`);
    console.log();

    if (verbose) {
      for (const [sym, sd] of sorted) {
        const testTag = sd.prodFiles.size === 0 ? ' [test-only]' : '';
        const fileCount = sd.prodFiles.size || sd.testFiles.size;
        console.log(`  ${sym}  (${fileCount} ${sd.prodFiles.size === 0 ? 'test' : 'prod'} file${fileCount > 1 ? 's' : ''})${testTag}`);

        if (showFiles) {
          for (const f of sd.prodFiles) console.log(`    📄 ${f}`);
          for (const f of sd.testFiles) console.log(`    🧪 ${f}`);
        }
      }
      console.log();
    } else {
      // Compact: show top 5 + bottom 5
      const top5 = sorted.slice(0, 5);
      for (const [sym, sd] of top5) {
        const testTag = sd.prodFiles.size === 0 ? ' [test-only]' : '';
        console.log(`  ${sym}  (${sd.prodFiles.size || sd.testFiles.size} file${sd.files.size > 1 ? 's' : ''})${testTag}`);
      }
      if (sorted.length > 10) {
        console.log(`  ... ${sorted.length - 10} more ...`);
      }
      const bottom5 = sorted.slice(-Math.min(5, Math.max(0, sorted.length - 5)));
      if (sorted.length > 5) {
        for (const [sym, sd] of bottom5) {
          const testTag = sd.prodFiles.size === 0 ? ' [test-only]' : '';
          console.log(`  ${sym}  (${sd.prodFiles.size || sd.testFiles.size} file${sd.files.size > 1 ? 's' : ''})${testTag}`);
        }
      }
      console.log();
    }

    // Consumer file heatmap (top coupled files)
    if (verbose || showFiles) {
      const fileHeat = new Map();
      for (const [, sd] of pd.runtime) {
        for (const f of sd.files) fileHeat.set(f, (fileHeat.get(f) || 0) + 1);
      }
      const hotFiles = [...fileHeat.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      console.log(`  🔥 Most coupled consumer files:`);
      for (const [f, count] of hotFiles) {
        const tag = classifyFile(f) === 'test' ? ' [test]' : '';
        console.log(`    ${count} symbols ← ${f}${tag}`);
      }
      console.log();
    }
  } else {
    console.log();
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════');
console.log(' Summary');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Runtime symbols:     ${totalRuntime} (${totalProdOnly} prod, ${totalTestOnly} test-only)`);
console.log(`  Type-only symbols:   ${totalType} (free)`);
console.log(`  Cross-layer errors:  ${totalCrossLayer}`);
console.log();

if (totalCrossLayer > 0) {
  console.log(`  ✗ ${totalCrossLayer} cross-layer violation(s) — libraries must not import system packages`);
}

if (failures > 0) {
  console.log(`  ✗ ${failures} package(s) over their runtime coupling target`);
  console.log();
  process.exit(1);
} else {
  console.log(`  ✓ All packages within runtime coupling targets`);
  console.log();
}
