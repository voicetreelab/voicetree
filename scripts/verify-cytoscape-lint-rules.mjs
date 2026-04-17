import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(scriptsDir, '..')

const runLint = () => {
  try {
    const output = execFileSync('npm', ['run', 'lint'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    return { exitCode: 0, output }
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    }
  }
}

const ensureCleanLint = () => {
  const result = runLint()

  if (result.exitCode !== 0) {
    throw new Error(`Expected clean lint before seeding violations.\n${result.output}`)
  }
}

const seedViolationAndExpectFailure = ({ label, filePath, content, expectedSnippets }) => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)

  const failingResult = runLint()

  if (failingResult.exitCode === 0) {
    throw new Error(`${label}: lint unexpectedly passed with a seeded violation.`)
  }

  for (const snippet of expectedSnippets) {
    if (!failingResult.output.includes(snippet)) {
      throw new Error(`${label}: lint output did not include "${snippet}".\n${failingResult.output}`)
    }
  }

  rmSync(filePath)

  const cleanResult = runLint()

  if (cleanResult.exitCode !== 0) {
    throw new Error(`${label}: lint did not recover after removing the seeded violation.\n${cleanResult.output}`)
  }
}

ensureCleanLint()

seedViolationAndExpectFailure({
  label: 'pure-package import rule',
  filePath: path.join(repoRoot, 'packages/graph-model/src/SEED_VIOLATION.ts'),
  content: 'import cytoscape from "cytoscape";\n',
  expectedSnippets: [
    'packages/graph-model/src/SEED_VIOLATION.ts',
    'no-restricted-imports',
    'Cytoscape must stay out of @vt/graph-model and @vt/graph-tools.',
  ],
})

seedViolationAndExpectFailure({
  label: 'business-layer cy.* rule',
  filePath: path.join(repoRoot, 'webapp/src/shell/business/SEED_VIOLATION.ts'),
  content: [
    'const cy: { add(node: { readonly data: { readonly id: string } }): unknown } = {',
    '  add: (_node) => undefined,',
    '};',
    '',
    'cy.add({ data: { id: "seed" } });',
  ].join('\n'),
  expectedSnippets: [
    'webapp/src/shell/business/SEED_VIOLATION.ts',
    'no-restricted-syntax',
    'Business-layer files must not reach into Cytoscape via cy.*.',
  ],
})

console.log('Verified BF-140 lint rules with seeded violations.')
