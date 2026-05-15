import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {readdir, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_PATH = join(REPO_ROOT, 'scripts', 'measure-relative-paths.report.json')
const ENFORCE = process.argv.includes('--enforce')

const REQUESTED_SCOPE_ROOTS = [
  'webapp/src',
  'packages/systems/*/src',
  'packages/libraries/*/src',
  'packages/systems/voicetree-mcp/bin',
]

const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '__tests__', 'integration-tests'])

const sourceRoots = await discoverSourceRoots()
const files = await listProductionSourceFiles(sourceRoots)
if (files.length === 0) {
  throw new Error('measure-relative-paths found 0 production source files; check source globs')
}

const records = collectRelativePathRecords(files)
const summary = summarizeRecords(records, files.length)

writeFileSync(REPORT_PATH, `${JSON.stringify(summary, null, 2)}\n`)
printReport(summary)
if (ENFORCE && summary.totals.bannedRelativePaths > 0) {
  console.error(`Relative path depth gate failed: ${summary.totals.bannedRelativePaths} banned relative path string(s) found`)
  process.exit(1)
}

async function discoverSourceRoots() {
  const packageSrcRoots = await Promise.all([
    discoverPackageSrcRoots(join(REPO_ROOT, 'packages', 'systems')),
    discoverPackageSrcRoots(join(REPO_ROOT, 'packages', 'libraries')),
  ])

  return [
    join(REPO_ROOT, 'webapp', 'src'),
    ...packageSrcRoots.flat(),
    join(REPO_ROOT, 'packages', 'systems', 'voicetree-mcp', 'bin'),
  ]
}

async function discoverPackageSrcRoots(layerRoot) {
  if (!(await pathExists(layerRoot))) return []
  const entries = await readdir(layerRoot, {withFileTypes: true})
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => join(layerRoot, entry.name, 'src'))
}

async function listProductionSourceFiles(roots) {
  const nested = await Promise.all(roots.map(async root => {
    if (!(await pathExists(root))) return []
    return listProductionSourcesUnder(root)
  }))

  return [...new Set(nested.flat())].sort((a, b) => relative(REPO_ROOT, a).localeCompare(relative(REPO_ROOT, b)))
}

async function listProductionSourcesUnder(root) {
  const entries = await readdir(root, {withFileTypes: true})
  const nested = await Promise.all(entries.map(async entry => {
    const absolutePath = join(root, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) return []
      return listProductionSourcesUnder(absolutePath)
    }
    if (!entry.isFile() || !isProductionTypeScriptSource(absolutePath)) return []
    return [absolutePath]
  }))
  return nested.flat()
}

function isProductionTypeScriptSource(path) {
  return /\.(ts|tsx)$/.test(path)
    && !/\.d\.ts$/.test(path)
    && !/\.(test|spec)\.(ts|tsx)$/.test(path)
    && !/\.config\.ts$/.test(path)
    && !containsExcludedSegment(path)
}

function containsExcludedSegment(path) {
  const segments = relative(REPO_ROOT, path).split(sep)
  return segments.some(segment => EXCLUDED_DIR_NAMES.has(segment))
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function collectRelativePathRecords(sourceFiles) {
  return sourceFiles.flatMap(file => {
    const text = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    return extractPathStringLiterals(sourceFile)
      .filter(site => isDeepRelativePath(site.value))
      .map(site => ({
        file: normalizePath(relative(REPO_ROOT, file)),
        line: site.line,
        column: site.column,
        kind: site.kind,
        value: site.value,
        depth: relativeDepthBucket(site.value),
        statement: statementTextAt(sourceFile, site.line),
      }))
  })
}

function extractPathStringLiterals(sourceFile) {
  const sites = []
  const importSpecifierNodes = new Set(collectImportSpecifierNodes(sourceFile))

  function visit(node) {
    if (importSpecifierNodes.has(node)) {
      // Skip — already covered by measure-relative-imports.
    } else if (ts.isStringLiteral(node)) {
      sites.push(literalSite('string-literal', node.text, node, sourceFile))
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      sites.push(literalSite('template-no-substitution', node.text, node, sourceFile))
    } else if (ts.isTemplateExpression(node)) {
      // Only the head span can declare a literal prefix; capture it as-is.
      sites.push(literalSite('template-head', node.head.text, node.head, sourceFile))
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return sites
}

function collectImportSpecifierNodes(sourceFile) {
  const nodes = []

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      nodes.push(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      nodes.push(node.moduleSpecifier)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [firstArg] = node.arguments
      if (firstArg && ts.isStringLiteralLike(firstArg)) nodes.push(firstArg)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      nodes.push(node.argument.literal)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression
      if (ts.isStringLiteralLike(expression)) nodes.push(expression)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return nodes
}

function literalSite(kind, value, node, sourceFile) {
  const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return {
    kind,
    value,
    line: line + 1,
    column: character + 1,
  }
}

function isDeepRelativePath(value) {
  return /^\.\.\/\.\.\//.test(value)
}

function relativeDepthBucket(value) {
  const matches = value.match(/^(\.\.\/)+/)
  const depth = matches ? matches[0].split('../').length - 1 : 0
  if (depth === 2) return '../../x'
  return '../../../+x'
}

function statementTextAt(sourceFile, oneBasedLine) {
  const lineStarts = sourceFile.getLineStarts()
  const start = lineStarts[oneBasedLine - 1] ?? 0
  const end = lineStarts[oneBasedLine] ?? sourceFile.getFullText().length
  return sourceFile.getFullText().slice(start, end).trim()
}

function summarizeRecords(allRecords, sourceFileCount) {
  return {
    generatedAt: new Date().toISOString(),
    sourceFileCount,
    scope: {
      requestedRoots: REQUESTED_SCOPE_ROOTS,
      scannedRoots: sourceRoots.map(root => normalizePath(relative(REPO_ROOT, root))),
      excluded: [
        '.test.ts',
        '.spec.ts',
        '.d.ts',
        '__tests__',
        'integration-tests',
        'node_modules',
        'dist',
        'build',
        '*.config.ts',
      ],
      note: 'Scans non-import string + template-literal heads for paths matching /^\\.\\.\\/\\.\\.\\//. Import specifiers are covered by measure-relative-imports.',
    },
    totals: {
      relativePaths: allRecords.length,
      bannedRelativePaths: allRecords.length,
    },
    byDepth: countBy(allRecords, record => record.depth, ['../../x', '../../../+x']),
    byKind: countBy(allRecords, record => record.kind, ['string-literal', 'template-no-substitution', 'template-head']),
    perFile: summarizePerFile(allRecords),
    bannedRelativePaths: allRecords.map(record => ({
      file: record.file,
      line: record.line,
      column: record.column,
      kind: record.kind,
      depth: record.depth,
      value: record.value,
      statement: record.statement,
    })),
  }
}

function summarizePerFile(records) {
  const byFile = new Map()
  for (const record of records) {
    const data = byFile.get(record.file) ?? {file: record.file, count: 0}
    data.count += 1
    byFile.set(record.file, data)
  }
  return [...byFile.values()].sort((a, b) =>
    b.count - a.count || a.file.localeCompare(b.file))
}

function countBy(records, keyFn, orderedKeys) {
  const counts = Object.fromEntries(orderedKeys.map(key => [key, 0]))
  for (const record of records) {
    counts[keyFn(record)] = (counts[keyFn(record)] ?? 0) + 1
  }
  return counts
}

function printReport(summary) {
  console.log('Relative path measurement report')
  console.log('')
  console.log(`Source files scanned: ${summary.sourceFileCount}`)
  console.log(`Banned relative paths (../../+ in string / template literal): ${summary.totals.bannedRelativePaths}`)
  console.log('')
  console.log('By depth:')
  for (const [depth, count] of Object.entries(summary.byDepth)) {
    console.log(`  ${depth}: ${count}`)
  }
  console.log('')
  console.log('By literal kind:')
  for (const [kind, count] of Object.entries(summary.byKind)) {
    console.log(`  ${kind}: ${count}`)
  }
  console.log('')
  if (summary.bannedRelativePaths.length === 0) {
    console.log('No banned relative paths found.')
  } else {
    console.log('Banned relative paths:')
    for (const record of summary.bannedRelativePaths) {
      console.log(`  ${record.file}:${record.line}:${record.column} ${JSON.stringify(record.value)}`)
    }
  }
  console.log('')
  console.log(`JSON report written to ${normalizePath(relative(REPO_ROOT, REPORT_PATH))}`)
}

function normalizePath(path) {
  return path.split(sep).join('/')
}
