import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const packageJsonPath = path.join(repoRoot, 'package.json');
const e2eRoot = path.join(repoRoot, 'e2e-tests');

const allowedSpecPrefixes = [
  'highest-value-system/',
  'electron/critical_e2e_verification_tests/',
  'playwright-browser/critical_for_verification/',
  'electron/for_feature_development_not_LT_verification/',
  'playwright-browser/for_feature_development_skip/',
];

const forbiddenScriptPatterns = [
  /for_feature_development/i,
  /for-feature-development/i,
  /feature-dev/i,
  /playwright-browser-dev\.config/i,
  /playwright-electron-dev\.config/i,
];

const errors = [];

const toPosix = (value) => value.split(path.sep).join('/');

const collectSpecFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSpecFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.spec.ts') ? [fullPath] : [];
  }));
  return nested.flat();
};

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const scripts = packageJson.scripts ?? {};

for (const [name, command] of Object.entries(scripts)) {
  if (!name.startsWith('test') && !name.startsWith('check')) {
    continue;
  }

  if (forbiddenScriptPatterns.some((pattern) => pattern.test(`${name} ${command}`))) {
    errors.push(`Script "${name}" references feature-development tests: ${command}`);
  }
}

const specFiles = await collectSpecFiles(e2eRoot);
const relativeSpecs = specFiles.map((specPath) => toPosix(path.relative(e2eRoot, specPath)));
const tier1Specs = relativeSpecs.filter((specPath) => specPath.startsWith('highest-value-system/'));

if (tier1Specs.length < 1) {
  errors.push(`Tier 1 must contain at least one .spec.ts file; found ${tier1Specs.length}.`);
}

for (const specPath of relativeSpecs) {
  if (!allowedSpecPrefixes.some((prefix) => specPath.startsWith(prefix))) {
    errors.push(`E2E spec is outside allowed tier directories: e2e-tests/${specPath}`);
  }
}

if (errors.length > 0) {
  console.error('E2E taxonomy check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`E2E taxonomy check passed (${relativeSpecs.length} spec files, ${tier1Specs.length} Tier 1 spec).`);
