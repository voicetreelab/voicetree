import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const pkgRoot = join(import.meta.dirname, '..', 'packages');
const graph = new Map();

const subdirs = ['libraries', 'systems'];
for (const sub of subdirs) {
  const subDir = join(pkgRoot, sub);
  for (const dir of readdirSync(subDir)) {
    const dirPath = join(subDir, dir);
    if (!statSync(dirPath).isDirectory()) continue;
    const pj = JSON.parse(readFileSync(join(dirPath, 'package.json'), 'utf8'));
  const vtDeps = Object.keys(pj.dependencies ?? {})
    .filter(d => d.startsWith('@vt/'));
  graph.set(pj.name, vtDeps);
  }
}

function findCycle(node, visited = new Set(), path = []) {
  if (path.includes(node)) return [...path.slice(path.indexOf(node)), node];
  if (visited.has(node)) return null;
  visited.add(node);
  path.push(node);
  for (const dep of graph.get(node) ?? []) {
    const cycle = findCycle(dep, visited, path);
    if (cycle) return cycle;
  }
  path.pop();
  return null;
}

const visited = new Set();
for (const pkg of graph.keys()) {
  const cycle = findCycle(pkg, visited);
  if (cycle) {
    console.error(`CIRCULAR DEPENDENCY: ${cycle.join(' → ')}`);
    process.exit(1);
  }
}
console.log(`✓ No circular deps among ${graph.size} @vt/* packages`);
