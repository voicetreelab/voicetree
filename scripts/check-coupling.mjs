import { execSync } from 'child_process';
import { join } from 'path';
import { readdirSync } from 'fs';
import { pathToFileURL } from 'url';

const SYSTEM_PACKAGES = new Set([
  '@vt/graph-db-server',
  '@vt/agent-runtime',
  '@vt/voicetree-mcp',
  '@vt/graph-db-client',
]);

const RUNTIME_THRESHOLD = 15;
const DAEMON_OWNED_NON_LAUNCHER_RUNTIME_IMPORT_THRESHOLD = 0;
const root = join(import.meta.dirname, '..');
const INVARIANTS_DIR = join(root, 'packages/measures/src/health/coupling/invariants');
const ALLOWED_GRAPH_DB_SERVER_RUNTIME_IMPORT_FILES = new Set([
  // vaultless daemon launcher (analogous to serve.ts for CLI)
  'packages/systems/graph-db-client/src/autoLaunch/vaultlessSpawn.ts',
  'webapp/src/shell/edge/main/cli/commands/runtime/serve.ts',
  'webapp/src/shell/edge/main/cli/commands/runtime/daemonRouteParity.ts',
  'webapp/src/shell/edge/main/cli/commands/graph/actions/index-cmds.ts',
  'webapp/src/shell/edge/main/cli/commands/graph/core/types.ts',
  'packages/systems/voicetree-mcp/bin/vt-mcpd.ts',
]);

function buildPackageDirMap() {
  const map = new Map();
  for (const layer of ['libraries', 'systems']) {
    const layerDir = join(root, 'packages', layer);
    try {
      for (const dir of readdirSync(layerDir)) {
        map.set(`@vt/${dir}`, `packages/${layer}/${dir}/`);
      }
    } catch { /* layer dir may not exist */ }
  }
  return map;
}

async function loadCouplingInvariants() {
  let files = [];
  try {
    files = readdirSync(INVARIANTS_DIR)
      .filter(f => f.endsWith('.mjs') && !f.startsWith('_'))
      .sort();
  } catch {
    return [];
  }

  const invariants = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(INVARIANTS_DIR, file)).href);
    if (mod.invariant) invariants.push(mod.invariant);
  }
  return invariants;
}

function grepLines(dirs) {
  try {
    return execSync(
      `grep -rn --include='*.ts' --include='*.tsx' -e "from '@vt/" -e 'from "@vt/' ${dirs}`,
      { encoding: 'utf8', cwd: root }
    );
  } catch (e) {
    if (e.status === 1) return '';
    throw e;
  }
}

function isTestFile(filePath) {
  return /\.(test|spec)\.(ts|tsx)$/.test(filePath)
    || filePath.includes('__tests__/')
    || filePath.includes('integration-tests/')
    || /\.helpers?\.(ts|tsx)$/.test(filePath);
}

const packageDirs = buildPackageDirMap();
const raw = grepLines('packages/libraries/ packages/systems/ webapp/src/');
const lines = raw.split('\n').filter(Boolean);

const packageData = new Map();

for (const line of lines) {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) continue;
  const filePath = line.slice(0, colonIdx);
  const rest = line.slice(colonIdx + 1);
  const secondColon = rest.indexOf(':');
  if (secondColon === -1) continue;
  const code = rest.slice(secondColon + 1);

  const pkgMatch = code.match(/from\s+['"](@vt\/[^/']+)(\/.+)?['"]/);
  if (!pkgMatch) continue;
  const pkg = pkgMatch[1];
  if (!SYSTEM_PACKAGES.has(pkg)) continue;

  const pkgDir = packageDirs.get(pkg);
  if (pkgDir && filePath.startsWith(pkgDir)) continue;

  const isWholeTypeImport = /(?:import|export)\s+type\s*\{/.test(code);
  const symbolMatch = code.match(/(?:import|export)\s*(?:type\s*)?\{([^}]*)\}/);
  if (!symbolMatch) continue;

  const isReExport = /export\s*(?:type\s*)?\{/.test(code);
  const test = isTestFile(filePath);

  if (!packageData.has(pkg)) {
    packageData.set(pkg, {
      runtime: { prod: new Map(), test: new Map() },
      types: new Set(),
      reExportFiles: new Set(),
    });
  }
  const data = packageData.get(pkg);
  const siteMap = test ? data.runtime.test : data.runtime.prod;

  if (isReExport && !test) data.reExportFiles.add(filePath);

  const rawSymbols = symbolMatch[1].split(',').map(s => s.trim()).filter(Boolean);

  for (const sym of rawSymbols) {
    const isType = isWholeTypeImport || sym.startsWith('type ');
    const name = sym.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
    if (!name) continue;

    if (isType) {
      data.types.add(name);
    } else {
      if (!siteMap.has(name)) siteMap.set(name, new Set());
      siteMap.get(name).add(filePath);
    }
  }
}

console.log('System package coupling report\n');
console.log('Metric: runtime (non-type) symbol fan-in from production consumer code.');
console.log('Type-only imports are free (compile-time only). Test imports reported separately.');
console.log(`Threshold: ${RUNTIME_THRESHOLD} production runtime symbols.\n`);

let failures = 0;
let daemonOwnedRatchetChecked = false;
const couplingInvariants = await loadCouplingInvariants();
const ranInvariantIds = new Set();

function symbolFileEntries(symbolFiles) {
  return [...symbolFiles.entries()].flatMap(([symbol, files]) =>
    [...files].map(file => ({ symbol, file }))
  );
}

function summarizeSymbolCounts(entries) {
  const counts = new Map();
  for (const { symbol, file } of entries) {
    if (!counts.has(symbol)) counts.set(symbol, new Set());
    counts.get(symbol).add(file);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .map(([symbol, files]) => `${symbol}(${files.size})`);
}

function checkDaemonOwnedMutationsRatchet(data) {
  const runtimeEntries = symbolFileEntries(data.runtime.prod);
  const allowlistedRuntimeEntries = runtimeEntries.filter(({ file }) =>
    ALLOWED_GRAPH_DB_SERVER_RUNTIME_IMPORT_FILES.has(file)
  );
  const nonLauncherRuntimeEntries = runtimeEntries.filter(({ file }) =>
    !ALLOWED_GRAPH_DB_SERVER_RUNTIME_IMPORT_FILES.has(file)
  );

  console.log('Daemon-owned-mutations coupling ratchet:');
  console.log(`  nonLauncherGraphDbServerRuntimeImports=${nonLauncherRuntimeEntries.length} / ${DAEMON_OWNED_NON_LAUNCHER_RUNTIME_IMPORT_THRESHOLD}${nonLauncherRuntimeEntries.length <= DAEMON_OWNED_NON_LAUNCHER_RUNTIME_IMPORT_THRESHOLD ? ' ✓' : ' FAIL'}`);
  console.log(`  allowlistedGraphDbServerRuntimeImports=${allowlistedRuntimeEntries.length}`);

  const allowlistedSummary = summarizeSymbolCounts(allowlistedRuntimeEntries);
  if (allowlistedSummary.length > 0) {
    console.log(`  allowlisted top: ${allowlistedSummary.join(', ')}`);
  }

  if (nonLauncherRuntimeEntries.length > 0) {
    console.log('  ── non-launcher production imports ──');
    for (const { symbol, file } of nonLauncherRuntimeEntries.sort((a, b) => a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol))) {
      console.log(`    ${file}: ${symbol}`);
    }
    failures++;
  }

  console.log('');
  daemonOwnedRatchetChecked = true;
}

function runCouplingInvariant(invariant, data) {
  const result = invariant.check(data);
  const ok = result.violationCount <= invariant.threshold;

  console.log(`${invariant.title}:`);
  for (const line of invariant.ruleLines) {
    console.log(`  rule: ${line}`);
  }
  console.log(`  violatingFiles=${result.violationCount} / ${invariant.threshold}${ok ? ' ✓' : ' FAIL'}`);
  console.log(`  violatingImports=${result.importCount}`);
  console.log(`  allowlistedImports=${result.allowlistedCount}`);

  if (result.allowlistedSummary.length > 0) {
    console.log(`  allowlisted top: ${result.allowlistedSummary.join(', ')}`);
  }

  if (result.violationsByFile.size > 0) {
    console.log('  ── invariant violations (RED) ──');
    for (const [file, symbols] of [...result.violationsByFile].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`    ${file}: ${symbols.sort().join(', ')}`);
    }
  }

  if (!ok) failures++;
  console.log('');
  ranInvariantIds.add(invariant.id);
}

for (const [pkg, data] of [...packageData].sort((a, b) => b[1].runtime.prod.size - a[1].runtime.prod.size)) {
  const rtProd = data.runtime.prod.size;
  const rtTest = data.runtime.test.size;
  const ty = data.types.size;
  const prodFiles = new Set([...data.runtime.prod.values()].flatMap(s => [...s])).size;
  const flag = rtProd > RUNTIME_THRESHOLD ? ' ⚠️' : ' ✓';

  console.log(`${pkg}: ${rtProd} runtime prod, ${rtTest} runtime test, ${ty} type-only${flag}`);

  if (rtProd > 0) {
    const sorted = [...data.runtime.prod.entries()].sort((a, b) => b[1].size - a[1].size);
    const top = sorted.slice(0, 8).map(([sym, files]) => `${sym}(${files.size})`);
    console.log(`  top: ${top.join(', ')}${sorted.length > 8 ? ', ...' : ''}`);
  }

  if (data.reExportFiles.size > 0) {
    console.log(`  ⚠️  re-exported through: ${[...data.reExportFiles].join(', ')}`);
  }

  if (pkg === '@vt/graph-db-server') {
    checkDaemonOwnedMutationsRatchet(data);
  }

  for (const invariant of couplingInvariants) {
    if (invariant.packageName === pkg) {
      runCouplingInvariant(invariant, data);
    }
  }

  if (rtProd > RUNTIME_THRESHOLD) {
    console.log(`  ── production files (${prodFiles}) ──`);
    const byFile = new Map();
    for (const [sym, files] of data.runtime.prod) {
      for (const f of files) {
        if (!byFile.has(f)) byFile.set(f, []);
        byFile.get(f).push(sym);
      }
    }
    for (const [file, syms] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`    ${file}: ${syms.sort().join(', ')}`);
    }
    failures++;
  }

  console.log('');
}

for (const pkg of SYSTEM_PACKAGES) {
  if (!packageData.has(pkg)) {
    console.log(`${pkg}: 0 runtime symbols ✓\n`);
  }
}

if (!daemonOwnedRatchetChecked) {
  console.log('Daemon-owned-mutations coupling ratchet:');
  console.log(`  nonLauncherGraphDbServerRuntimeImports=0 / ${DAEMON_OWNED_NON_LAUNCHER_RUNTIME_IMPORT_THRESHOLD} ✓`);
  console.log('  allowlistedGraphDbServerRuntimeImports=0\n');
}

for (const invariant of couplingInvariants) {
  if (!ranInvariantIds.has(invariant.id)) {
    runCouplingInvariant(invariant, {
      runtime: { prod: new Map(), test: new Map() },
      types: new Set(),
      reExportFiles: new Set(),
    });
  }
}

if (failures) {
  console.error(`✗ ${failures} coupling budget(s) exceeded`);
  process.exit(1);
}

console.log(`✓ All system packages within runtime symbol threshold (${RUNTIME_THRESHOLD})`);
