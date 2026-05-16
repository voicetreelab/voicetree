import {execSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'
import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {recordHealthReport} from '../packages/systems/_health-report-writer.ts'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SYSTEMS_ROOT = join(REPO_ROOT, 'packages', 'systems')
const REPORT_ONLY = process.argv.includes('--report-only')

const TARGETS = {
  maxCognitiveComplexity: 18,
  maxBoundaryRatio: 0.30,
  maxSubdirCrossRatio: 0.60,
  aggregateBoundaryComplexity: 16.0,
  maxRuntimeFanIn: 10,
  maxFileTurbulence: 250,
  maxPackageAverageTurbulence: 35,
  maxCyclomaticComplexity: 20,
  minMaintainabilityIndex: 60,
  maxCrapZeroCoverage: 300,
}

function runGit(args) {
  return execSync(`git ${args}`, {cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']})
}

function tryRunGit(args) {
  try {
    return runGit(args)
  } catch {
    return null
  }
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function discoverPackages() {
  const entries = await readdir(SYSTEMS_ROOT, {withFileTypes: true})
  const packages = await Promise.all(entries.map(async entry => {
    if (!entry.isDirectory()) return null
    const packageJsonPath = join(SYSTEMS_ROOT, entry.name, 'package.json')
    const srcRoot = join(SYSTEMS_ROOT, entry.name, 'src')
    if (!(await pathExists(packageJsonPath)) || !(await pathExists(srcRoot))) return null
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    return {
      name: packageJson.name,
      dirName: entry.name,
      srcRoot,
    }
  }))
  return packages.filter(Boolean).sort((a, b) => a.dirName.localeCompare(b.dirName))
}

function isProductionSource(path) {
  return path.endsWith('.ts')
    && !path.endsWith('.test.ts')
    && !path.endsWith('.spec.ts')
    && !path.endsWith('.d.ts')
    && !path.includes('/__tests__/')
}

async function listProductionSources(root) {
  if (!(await pathExists(root))) return []
  const entries = await readdir(root, {withFileTypes: true})
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return listProductionSources(path)
    if (entry.isFile() && isProductionSource(path)) return [path]
    return []
  }))
  return nested.flat().sort()
}

function subdirectoryOf(absolutePath, srcRoot) {
  const srcRelative = relative(srcRoot, absolutePath)
  const firstSlash = srcRelative.indexOf('/')
  return firstSlash >= 0 ? srcRelative.slice(0, firstSlash) : '.'
}

function extractImportDeclarations(filePath, text) {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
  const declarations = []

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      declarations.push({
        specifier: statement.moduleSpecifier.text,
        isTypeOnly: statement.importClause?.isTypeOnly ?? false,
        text: statement.getText(sourceFile),
      })
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      declarations.push({
        specifier: statement.moduleSpecifier.text,
        isTypeOnly: statement.isTypeOnly,
        text: statement.getText(sourceFile),
      })
    }
  }

  return declarations
}

function resolveFileCandidate(basePath, knownFiles) {
  const resolved = resolve(basePath)
  const candidates = resolved.endsWith('.ts')
    ? [resolved]
    : [resolved, `${resolved}.ts`, join(resolved, 'index.ts')]
  return candidates.find(candidate => knownFiles.has(candidate)) ?? null
}

function resolveSpecifier(fromAbsPath, specifier, packagesByNpmName, knownFiles) {
  if (specifier.startsWith('.')) {
    return resolveFileCandidate(join(dirname(fromAbsPath), specifier), knownFiles)
  }

  for (const [npmName, pkg] of packagesByNpmName) {
    if (specifier !== npmName && !specifier.startsWith(`${npmName}/`)) continue
    const subPath = specifier === npmName ? 'index' : specifier.slice(npmName.length + 1)
    return resolveFileCandidate(join(pkg.srcRoot, subPath), knownFiles)
  }

  return null
}

async function buildSystemGraph(packages) {
  const files = []
  for (const pkg of packages) {
    const paths = await listProductionSources(pkg.srcRoot)
    files.push(...paths.map(absolutePath => ({
      absolutePath: resolve(absolutePath),
      relativePath: relative(REPO_ROOT, absolutePath),
      packageName: pkg.dirName,
      npmName: pkg.name,
      subdirectory: subdirectoryOf(resolve(absolutePath), pkg.srcRoot),
    })))
  }

  const filesByPath = new Map(files.map(file => [file.absolutePath, file]))
  const knownFiles = new Set(filesByPath.keys())
  const packagesByNpmName = new Map(packages.map(pkg => [pkg.name, pkg]))
  const edges = []
  const runtimeSymbolsByTarget = new Map()
  const seenFileEdges = new Set()

  for (const fromFile of files) {
    const text = await readFile(fromFile.absolutePath, 'utf8')
    for (const declaration of extractImportDeclarations(fromFile.absolutePath, text)) {
      const toPath = resolveSpecifier(fromFile.absolutePath, declaration.specifier, packagesByNpmName, knownFiles)
      const toFile = toPath ? filesByPath.get(toPath) : null
      if (toFile && toFile.absolutePath !== fromFile.absolutePath) {
        const edgeKey = `${fromFile.relativePath}\0${toFile.relativePath}`
        if (!seenFileEdges.has(edgeKey)) {
          seenFileEdges.add(edgeKey)
          edges.push({
            from: fromFile.relativePath,
            to: toFile.relativePath,
            fromPackage: fromFile.packageName,
            toPackage: toFile.packageName,
            fromSubdirectory: fromFile.subdirectory,
            toSubdirectory: toFile.subdirectory,
          })
        }
      }

      const targetPkg = packages.find(pkg => declaration.specifier === pkg.name || declaration.specifier.startsWith(`${pkg.name}/`))
      if (!targetPkg || targetPkg.dirName === fromFile.packageName) continue
      if (!runtimeSymbolsByTarget.has(targetPkg.dirName)) runtimeSymbolsByTarget.set(targetPkg.dirName, new Map())
      const targetSymbols = runtimeSymbolsByTarget.get(targetPkg.dirName)
      collectRuntimeSymbols(declaration).forEach(symbol => {
        if (!targetSymbols.has(symbol)) targetSymbols.set(symbol, new Set())
        targetSymbols.get(symbol).add(fromFile.relativePath)
      })
    }
  }

  return {files, edges, runtimeSymbolsByTarget}
}

function collectRuntimeSymbols(declaration) {
  if (declaration.isTypeOnly) return []
  const match = declaration.text.match(/(?:import|export)\s*(?:type\s*)?\{([^}]*)\}/)
  if (!match) return declaration.text.includes('* as ') ? ['*'] : []

  return match[1]
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !part.startsWith('type '))
    .map(part => part.split(/\s+as\s+/)[0].trim())
    .filter(Boolean)
}

function isLogicalOperator(kind) {
  return kind === ts.SyntaxKind.AmpersandAmpersandToken
    || kind === ts.SyntaxKind.BarBarToken
    || kind === ts.SyntaxKind.QuestionQuestionToken
}

function isLogicalExpression(node) {
  return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
}

function countLogicalOperatorChains(expression) {
  const operators = []
  function collect(node) {
    if (!isLogicalExpression(node)) return
    collect(node.left)
    operators.push(node.operatorToken.kind)
    collect(node.right)
  }
  collect(expression)
  if (operators.length === 0) return 0
  let chains = 1
  for (let i = 1; i < operators.length; i += 1) {
    if (operators[i] !== operators[i - 1]) chains += 1
  }
  return chains
}

function propertyNameText(name, sourceFile) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return name.getText(sourceFile)
}

function functionName(node, sourceFile) {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text
  if (ts.isMethodDeclaration(node) && node.name) return propertyNameText(node.name, sourceFile)
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isPropertyAssignment(node.parent)) return propertyNameText(node.parent.name, sourceFile)
  return '<anonymous>'
}

function isFunctionLikeBoundary(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
}

function isDirectRecursiveCall(node, name) {
  if (name === '<anonymous>' || name === 'constructor') return false
  if (ts.isIdentifier(node.expression)) return node.expression.text === name
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text === name
  return false
}

function scoreFunction(root, name, sourceFile) {
  let score = 0
  const addStructural = nesting => { score += 1 + nesting }

  function visitIfStatement(node, nesting, isElseIf) {
    if (isElseIf) score += 1
    else addStructural(nesting)
    visit(node.expression, nesting)
    visit(node.thenStatement, nesting + 1)
    if (!node.elseStatement) return
    if (ts.isIfStatement(node.elseStatement)) {
      visitIfStatement(node.elseStatement, nesting, true)
      return
    }
    score += 1
    visit(node.elseStatement, nesting + 1)
  }

  function visit(node, nesting) {
    if (node !== root && isFunctionLikeBoundary(node)) return
    if (ts.isIfStatement(node)) {
      visitIfStatement(node, nesting, false)
      return
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      addStructural(nesting)
      ts.forEachChild(node, child => visit(child, nesting + 1))
      return
    }
    if (ts.isSwitchStatement(node)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) score += 1 + nesting
        ts.forEachChild(clause, child => visit(child, nesting + 1))
      }
      return
    }
    if (ts.isCatchClause(node)) {
      addStructural(nesting)
      visit(node.block, nesting + 1)
      return
    }
    if (ts.isConditionalExpression(node)) {
      addStructural(nesting)
      ts.forEachChild(node, child => visit(child, nesting + 1))
      return
    }
    if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label) score += 1
    if (ts.isCallExpression(node) && isDirectRecursiveCall(node, name)) score += 1
    if (isLogicalExpression(node) && !isLogicalExpression(node.parent)) score += countLogicalOperatorChains(node)
    ts.forEachChild(node, child => visit(child, nesting))
  }

  visit(root, 0)
  return score
}

async function measureCognitiveComplexity(files) {
  const rows = []
  for (const file of files) {
    const text = await readFile(file.absolutePath, 'utf8')
    const sourceFile = ts.createSourceFile(file.absolutePath, text, ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (isFunctionLikeBoundary(node)) {
        const name = functionName(node, sourceFile)
        const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        rows.push({
          packageName: file.packageName,
          file: file.relativePath,
          line: line + 1,
          name,
          score: scoreFunction(node, name, sourceFile),
        })
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(sourceFile, visit)
  }
  return rows.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
}

function cyclomaticIncrement(node) {
  if (ts.isIfStatement(node)
    || ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node)
    || ts.isWhileStatement(node)
    || ts.isDoStatement(node)
    || ts.isCatchClause(node)
    || ts.isConditionalExpression(node)) {
    return 1
  }
  if (ts.isCaseClause(node)) return 1
  if (isLogicalExpression(node)) return 1
  return 0
}

function scoreCyclomaticComplexity(root) {
  let score = 1
  function visit(node) {
    if (node !== root && isFunctionLikeBoundary(node)) return
    score += cyclomaticIncrement(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return score
}

async function measureCyclomaticComplexity(files) {
  const rows = []
  for (const file of files) {
    const text = await readFile(file.absolutePath, 'utf8')
    const sourceFile = ts.createSourceFile(file.absolutePath, text, ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (isFunctionLikeBoundary(node)) {
        const name = functionName(node, sourceFile)
        const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        const score = scoreCyclomaticComplexity(node)
        rows.push({
          packageName: file.packageName,
          file: file.relativePath,
          line: line + 1,
          name,
          score,
          crapZeroCoverage: score * score + score,
        })
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(sourceFile, visit)
  }
  return rows.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
}

function sourceLinesOfCode(text) {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
    .length
}

function isOperatorToken(kind) {
  return (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword)
    || (kind >= ts.SyntaxKind.FirstPunctuation && kind <= ts.SyntaxKind.LastPunctuation)
}

function isOperandToken(kind) {
  return kind === ts.SyntaxKind.Identifier
    || kind === ts.SyntaxKind.PrivateIdentifier
    || kind === ts.SyntaxKind.NumericLiteral
    || kind === ts.SyntaxKind.BigIntLiteral
    || kind === ts.SyntaxKind.StringLiteral
    || kind === ts.SyntaxKind.RegularExpressionLiteral
    || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
}

function measureHalstead(filePath, text, cyclomatic) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  const operators = new Map()
  const operands = new Map()
  let token = scanner.scan()

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const value = scanner.getTokenText()
    if (isOperatorToken(token)) operators.set(value, (operators.get(value) ?? 0) + 1)
    if (isOperandToken(token)) operands.set(value, (operands.get(value) ?? 0) + 1)
    token = scanner.scan()
  }

  const n1 = operators.size
  const n2 = operands.size
  const totalOperators = [...operators.values()].reduce((sum, count) => sum + count, 0)
  const totalOperands = [...operands.values()].reduce((sum, count) => sum + count, 0)
  const vocabulary = n1 + n2
  const length = totalOperators + totalOperands
  const volume = vocabulary === 0 || length === 0 ? 0 : length * Math.log2(vocabulary)
  const sloc = sourceLinesOfCode(text)
  const rawMaintainability = 171
    - 5.2 * Math.log(Math.max(1, volume))
    - 0.23 * cyclomatic
    - 16.2 * Math.log(Math.max(1, sloc))
  const maintainabilityIndex = Math.max(0, Math.min(100, (rawMaintainability * 100) / 171))

  return {
    file: relative(REPO_ROOT, filePath),
    sloc,
    vocabulary,
    length,
    volume,
    cyclomatic,
    maintainabilityIndex,
  }
}

async function measureMaintainability(files, cyclomaticRows) {
  const cyclomaticByFile = new Map()
  for (const row of cyclomaticRows) {
    cyclomaticByFile.set(row.file, (cyclomaticByFile.get(row.file) ?? 0) + row.score)
  }

  const rows = []
  for (const file of files) {
    const text = await readFile(file.absolutePath, 'utf8')
    rows.push(measureHalstead(file.absolutePath, text, cyclomaticByFile.get(file.relativePath) ?? 1))
  }
  return rows.sort((a, b) => a.maintainabilityIndex - b.maintainabilityIndex || a.file.localeCompare(b.file))
}

function countSimpleComplexity(filePath, text) {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
  let complexity = 0
  function visit(node) {
    if (ts.isIfStatement(node)
      || ts.isForStatement(node)
      || ts.isForInStatement(node)
      || ts.isForOfStatement(node)
      || ts.isWhileStatement(node)
      || ts.isDoStatement(node)
      || ts.isSwitchStatement(node)
      || ts.isCatchClause(node)
      || ts.isConditionalExpression(node)) {
      complexity += 1
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return complexity
}

function collectGitChurn() {
  const output = tryRunGit("log --since='6 months ago' --format=%H --name-only -- packages/systems") ?? ''
  const churn = new Map()
  for (const line of output.split('\n')) {
    const file = line.trim()
    if (!file || !file.startsWith('packages/systems/')) continue
    churn.set(file, (churn.get(file) ?? 0) + 1)
  }
  return churn
}

async function measureTurbulence(files) {
  const churn = collectGitChurn()
  const rows = []
  for (const file of files) {
    const text = await readFile(file.absolutePath, 'utf8')
    const fileChurn = churn.get(file.relativePath) ?? 0
    const complexity = countSimpleComplexity(file.absolutePath, text)
    rows.push({
      packageName: file.packageName,
      file: file.relativePath,
      churn: fileChurn,
      complexity,
      turbulence: fileChurn * complexity,
    })
  }
  return rows.sort((a, b) => b.turbulence - a.turbulence || a.file.localeCompare(b.file))
}

function mcsTreeWidthLowerBound(nodes, pairs) {
  if (nodes.length <= 1) return 0
  const adjacency = new Map(nodes.map(node => [node, new Set()]))
  for (const [a, b] of pairs) {
    adjacency.get(a)?.add(b)
    adjacency.get(b)?.add(a)
  }

  const numbered = new Set()
  let maxWidth = 0
  for (let i = 0; i < nodes.length; i += 1) {
    let bestNode = ''
    let bestCount = -1
    for (const node of nodes) {
      if (numbered.has(node)) continue
      let count = 0
      for (const neighbor of adjacency.get(node) ?? []) {
        if (numbered.has(neighbor)) count += 1
      }
      if (count > bestCount) {
        bestNode = node
        bestCount = count
      }
    }
    if (bestCount > 0) maxWidth = Math.max(maxWidth, bestCount)
    numbered.add(bestNode)
  }
  return maxWidth
}

function measureBoundaries(files, edges, packageNames) {
  const boundaryFiles = new Map(packageNames.map(name => [name, new Set()]))
  for (const edge of edges) {
    if (edge.fromPackage === edge.toPackage) continue
    boundaryFiles.get(edge.fromPackage)?.add(edge.from)
    boundaryFiles.get(edge.toPackage)?.add(edge.to)
  }

  const filesByPackage = new Map(packageNames.map(name => [name, files.filter(file => file.packageName === name)]))
  const boundaryProfiles = packageNames.map(packageName => {
    const totalFiles = filesByPackage.get(packageName)?.length ?? 0
    const count = boundaryFiles.get(packageName)?.size ?? 0
    return {
      packageName,
      boundaryFiles: count,
      totalFiles,
      ratio: totalFiles === 0 ? 0 : count / totalFiles,
    }
  }).sort((a, b) => b.ratio - a.ratio)

  const subdirProfiles = packageNames.map(packageName => {
    const internalEdges = edges.filter(edge => edge.fromPackage === packageName && edge.toPackage === packageName)
    const crossSubdirEdges = internalEdges.filter(edge => edge.fromSubdirectory !== edge.toSubdirectory)
    return {
      packageName,
      internalEdges: internalEdges.length,
      crossSubdirEdges: crossSubdirEdges.length,
      ratio: internalEdges.length === 0 ? 0 : crossSubdirEdges.length / internalEdges.length,
    }
  }).sort((a, b) => b.ratio - a.ratio)

  const pairGroups = new Map()
  for (const edge of edges) {
    if (edge.fromPackage === edge.toPackage) continue
    const key = `${edge.fromPackage} -> ${edge.toPackage}`
    if (!pairGroups.has(key)) pairGroups.set(key, [])
    pairGroups.get(key).push(edge)
  }

  const pairMetrics = [...pairGroups.entries()].map(([pair, pairEdges]) => {
    const src = new Set(pairEdges.map(edge => edge.from))
    const tgt = new Set(pairEdges.map(edge => edge.to))
    const srcNodes = [...src].map(file => `src:${file}`)
    const tgtNodes = [...tgt].map(file => `tgt:${file}`)
    const pairs = pairEdges.map(edge => [`src:${edge.from}`, `tgt:${edge.to}`])
    const treeWidth = mcsTreeWidthLowerBound([...srcNodes, ...tgtNodes], pairs)
    const density = src.size === 0 || tgt.size === 0 ? 0 : pairEdges.length / (src.size * tgt.size)
    return {
      pair,
      srcFan: src.size,
      tgtFan: tgt.size,
      edgeCount: pairEdges.length,
      density,
      treeWidth,
      bci: (treeWidth + 1) * Math.log2(pairEdges.length + 1),
    }
  }).sort((a, b) => b.bci - a.bci || a.pair.localeCompare(b.pair))

  return {
    boundaryProfiles,
    subdirProfiles,
    pairMetrics,
    aggregateBci: pairMetrics.reduce((sum, pair) => sum + pair.bci, 0),
  }
}

function runtimeFanInRows(runtimeSymbolsByTarget) {
  return [...runtimeSymbolsByTarget.entries()].map(([packageName, symbols]) => ({
    packageName,
    runtimeSymbols: symbols.size,
    top: [...symbols.entries()]
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([symbol, files]) => `${symbol}(${files.size})`),
  })).sort((a, b) => b.runtimeSymbols - a.runtimeSymbols || a.packageName.localeCompare(b.packageName))
}

function aggregateTurbulence(rows) {
  const grouped = new Map()
  for (const row of rows) {
    if (!grouped.has(row.packageName)) grouped.set(row.packageName, [])
    grouped.get(row.packageName).push(row)
  }

  return [...grouped.entries()].map(([packageName, files]) => {
    const total = files.reduce((sum, row) => sum + row.turbulence, 0)
    const maxFile = [...files].sort((a, b) => b.turbulence - a.turbulence || a.file.localeCompare(b.file))[0] ?? null
    return {
      packageName,
      files: files.length,
      total,
      average: files.length === 0 ? 0 : total / files.length,
      maxFile,
    }
  }).sort((a, b) => b.average - a.average || a.packageName.localeCompare(b.packageName))
}

function changedStatusEntries() {
  const output = tryRunGit('status --porcelain') ?? ''
  return output.split('\n').map(line => line.trimEnd()).filter(Boolean)
}

function guardFindings() {
  const findings = []
  const currentPackageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  const committedPackageJsonRaw = tryRunGit('show HEAD:package.json')
  if (committedPackageJsonRaw) {
    const committedPackageJson = JSON.parse(committedPackageJsonRaw)
    for (const scriptName of ['test', 'test:codebase-health', 'check:coupling', 'check:circular-deps']) {
      if (currentPackageJson.scripts?.[scriptName] !== committedPackageJson.scripts?.[scriptName]) {
        findings.push(`package.json script "${scriptName}" changed; complexity pressure must not be won by relaxing green gates`)
      }
    }
  }

  const deletedTests = changedStatusEntries()
    .filter(line => line.startsWith('D ') || line.startsWith(' D'))
    .map(line => line.slice(2).trim())
    .filter(path => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path))
  if (deletedTests.length > 0) {
    findings.push(`deleted test files detected: ${deletedTests.join(', ')}`)
  }

  for (const file of [
    'packages/systems/gate-integrity.test.ts',
    'packages/systems/purity-ratio-ast.test.ts',
    'packages/systems/cognitive-complexity.test.ts',
    'packages/systems/cross-package-coupling.test.ts',
  ]) {
    if (!existsSync(join(REPO_ROOT, file))) findings.push(`required health gate file missing: ${file}`)
  }

  return findings
}

function ratio(value, target) {
  return target === 0 ? 0 : value / target
}

const PRESSURE_AXIS_REPORTS = {
  'max cognitive complexity': {
    metricId: 'complexity-pressure-cognitive-max',
    metricName: 'Pressure: Max Cognitive Complexity',
    description: 'Highest per-function cognitive complexity score across systems packages.',
    category: 'Complexity',
    comparison: 'lte',
    unit: 'score',
  },
  'max cyclomatic complexity': {
    metricId: 'complexity-pressure-cyclomatic-max',
    metricName: 'Pressure: Max Cyclomatic Complexity',
    description: 'Highest per-function cyclomatic complexity score across systems packages.',
    category: 'Complexity',
    comparison: 'lte',
    unit: 'score',
  },
  'min maintainability index': {
    metricId: 'complexity-pressure-maintainability-min',
    metricName: 'Pressure: Min Maintainability Index',
    description: 'Lowest per-file Halstead-based maintainability index across systems packages.',
    category: 'Complexity',
    comparison: 'gte',
    unit: 'index',
  },
  'max CRAP0 risk': {
    metricId: 'complexity-pressure-crap0-max',
    metricName: 'Pressure: Max CRAP0 Risk',
    description: 'Worst CRAP0 (uncovered-CRAP) score; combines cyclomatic complexity with zero-coverage assumption.',
    category: 'Complexity',
    comparison: 'lte',
    unit: 'score',
  },
  'max boundary ratio': {
    metricId: 'complexity-pressure-boundary-ratio-max',
    metricName: 'Pressure: Max Boundary File Ratio',
    description: 'Highest share of a package\'s files participating in cross-package edges.',
    category: 'Coupling',
    comparison: 'lte',
    unit: 'ratio',
  },
  'max subdirectory cross-edge ratio': {
    metricId: 'complexity-pressure-subdir-cross-ratio-max',
    metricName: 'Pressure: Max Subdir Cross-Edge Ratio',
    description: 'Highest share of intra-package edges that cross subdirectory boundaries.',
    category: 'Coupling',
    comparison: 'lte',
    unit: 'ratio',
  },
  'aggregate boundary complexity': {
    metricId: 'complexity-pressure-boundary-complexity-aggregate',
    metricName: 'Pressure: Aggregate Boundary Complexity',
    description: 'Sum of BCI scores (tree-width × log edges) across every cross-package import pair.',
    category: 'Coupling',
    comparison: 'lte',
    unit: 'bci',
  },
  'max runtime fan-in': {
    metricId: 'complexity-pressure-runtime-fan-in-max',
    metricName: 'Pressure: Max Runtime Fan-In',
    description: 'Largest count of distinct runtime symbols imported from a single package across the systems graph.',
    category: 'Coupling',
    comparison: 'lte',
    unit: 'symbols',
  },
  'max file turbulence': {
    metricId: 'complexity-pressure-file-turbulence-max',
    metricName: 'Pressure: Max File Turbulence',
    description: '6-month churn × structural complexity for the most turbulent file.',
    category: 'Churn',
    comparison: 'lte',
    unit: 'turbulence',
  },
  'max package avg turbulence': {
    metricId: 'complexity-pressure-package-turbulence-avg-max',
    metricName: 'Pressure: Max Package Avg Turbulence',
    description: 'Highest per-package average turbulence (sum of file turbulence ÷ file count).',
    category: 'Churn',
    comparison: 'lte',
    unit: 'turbulence',
  },
}

async function recordPressureAxes(metrics) {
  for (const metric of metrics) {
    const config = PRESSURE_AXIS_REPORTS[metric.axis]
    if (!config) continue
    const passed = config.comparison === 'lte'
      ? metric.value <= metric.target
      : metric.value >= metric.target
    await recordHealthReport({
      metricId: config.metricId,
      metricName: config.metricName,
      description: config.description,
      category: config.category,
      current: metric.value,
      budget: metric.target,
      comparison: config.comparison,
      passed,
      unit: config.unit,
      timestamp: new Date().toISOString(),
      details: {
        axis: metric.axis,
        debtRatio: metric.ratio,
        worstOffender: metric.offender,
      },
    })
  }
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

function printTable(title, rows, columns) {
  console.log(`\n${title}`)
  console.log(columns.map(column => column.label).join(' | '))
  console.log(columns.map(column => '-'.repeat(column.label.length)).join(' | '))
  for (const row of rows) {
    console.log(columns.map(column => column.format ? column.format(row[column.key], row) : String(row[column.key])).join(' | '))
  }
}

async function main() {
  const packages = await discoverPackages()
  const packageNames = packages.map(pkg => pkg.dirName)
  const graph = await buildSystemGraph(packages)
  const cognitive = await measureCognitiveComplexity(graph.files)
  const cyclomatic = await measureCyclomaticComplexity(graph.files)
  const maintainability = await measureMaintainability(graph.files, cyclomatic)
  const turbulence = await measureTurbulence(graph.files)
  const packageTurbulence = aggregateTurbulence(turbulence)
  const boundaries = measureBoundaries(graph.files, graph.edges, packageNames)
  const runtimeFanIn = runtimeFanInRows(graph.runtimeSymbolsByTarget)
  const guards = guardFindings()

  const metrics = [
    {
      axis: 'max cognitive complexity',
      value: cognitive[0]?.score ?? 0,
      target: TARGETS.maxCognitiveComplexity,
      ratio: ratio(cognitive[0]?.score ?? 0, TARGETS.maxCognitiveComplexity),
      offender: cognitive[0] ? `${cognitive[0].file}:${cognitive[0].line} ${cognitive[0].name}` : 'n/a',
    },
    {
      axis: 'max cyclomatic complexity',
      value: cyclomatic[0]?.score ?? 0,
      target: TARGETS.maxCyclomaticComplexity,
      ratio: ratio(cyclomatic[0]?.score ?? 0, TARGETS.maxCyclomaticComplexity),
      offender: cyclomatic[0] ? `${cyclomatic[0].file}:${cyclomatic[0].line} ${cyclomatic[0].name}` : 'n/a',
    },
    {
      axis: 'min maintainability index',
      value: maintainability[0]?.maintainabilityIndex ?? 100,
      target: TARGETS.minMaintainabilityIndex,
      ratio: ratio(TARGETS.minMaintainabilityIndex, Math.max(1, maintainability[0]?.maintainabilityIndex ?? 100)),
      offender: maintainability[0]?.file ?? 'n/a',
    },
    {
      axis: 'max CRAP0 risk',
      value: [...cyclomatic].sort((a, b) => b.crapZeroCoverage - a.crapZeroCoverage)[0]?.crapZeroCoverage ?? 0,
      target: TARGETS.maxCrapZeroCoverage,
      ratio: ratio([...cyclomatic].sort((a, b) => b.crapZeroCoverage - a.crapZeroCoverage)[0]?.crapZeroCoverage ?? 0, TARGETS.maxCrapZeroCoverage),
      offender: (() => {
        const row = [...cyclomatic].sort((a, b) => b.crapZeroCoverage - a.crapZeroCoverage)[0]
        return row ? `${row.file}:${row.line} ${row.name}` : 'n/a'
      })(),
    },
    {
      axis: 'max boundary ratio',
      value: boundaries.boundaryProfiles[0]?.ratio ?? 0,
      target: TARGETS.maxBoundaryRatio,
      ratio: ratio(boundaries.boundaryProfiles[0]?.ratio ?? 0, TARGETS.maxBoundaryRatio),
      offender: boundaries.boundaryProfiles[0]?.packageName ?? 'n/a',
    },
    {
      axis: 'max subdirectory cross-edge ratio',
      value: boundaries.subdirProfiles[0]?.ratio ?? 0,
      target: TARGETS.maxSubdirCrossRatio,
      ratio: ratio(boundaries.subdirProfiles[0]?.ratio ?? 0, TARGETS.maxSubdirCrossRatio),
      offender: boundaries.subdirProfiles[0]?.packageName ?? 'n/a',
    },
    {
      axis: 'aggregate boundary complexity',
      value: boundaries.aggregateBci,
      target: TARGETS.aggregateBoundaryComplexity,
      ratio: ratio(boundaries.aggregateBci, TARGETS.aggregateBoundaryComplexity),
      offender: boundaries.pairMetrics[0]?.pair ?? 'n/a',
    },
    {
      axis: 'max runtime fan-in',
      value: runtimeFanIn[0]?.runtimeSymbols ?? 0,
      target: TARGETS.maxRuntimeFanIn,
      ratio: ratio(runtimeFanIn[0]?.runtimeSymbols ?? 0, TARGETS.maxRuntimeFanIn),
      offender: runtimeFanIn[0]?.packageName ?? 'n/a',
    },
    {
      axis: 'max file turbulence',
      value: turbulence[0]?.turbulence ?? 0,
      target: TARGETS.maxFileTurbulence,
      ratio: ratio(turbulence[0]?.turbulence ?? 0, TARGETS.maxFileTurbulence),
      offender: turbulence[0]?.file ?? 'n/a',
    },
    {
      axis: 'max package avg turbulence',
      value: packageTurbulence[0]?.average ?? 0,
      target: TARGETS.maxPackageAverageTurbulence,
      ratio: ratio(packageTurbulence[0]?.average ?? 0, TARGETS.maxPackageAverageTurbulence),
      offender: packageTurbulence[0]?.packageName ?? 'n/a',
    },
  ].sort((a, b) => b.ratio - a.ratio)

  await recordPressureAxes(metrics)

  const topRatios = metrics.map(metric => metric.ratio).sort((a, b) => b - a).slice(0, 5)
  const rscd = (topRatios[0] ?? 0) + 0.25 * (topRatios.reduce((sum, value) => sum + value, 0) / Math.max(1, topRatios.length))
  const failingMetrics = metrics.filter(metric => metric.ratio > 1)

  console.log('Complexity health pressure report')
  console.log(`Mode: ${REPORT_ONLY ? 'report-only' : 'failing pressure gate'}`)
  console.log(`RSCD: ${rscd.toFixed(3)} (target <= 1.000)`)

  if (guards.length > 0) {
    console.log('\nGuard failures:')
    guards.forEach(finding => console.log(`  - ${finding}`))
  }

  printTable('Pressure axes', metrics, [
    {key: 'axis', label: 'Axis'},
    {key: 'value', label: 'Value', format: formatNumber},
    {key: 'target', label: 'Target', format: formatNumber},
    {key: 'ratio', label: 'Debt', format: value => value.toFixed(3)},
    {key: 'offender', label: 'Worst offender'},
  ])

  printTable('Top cognitive complexity offenders', cognitive.slice(0, 10), [
    {key: 'score', label: 'Score'},
    {key: 'packageName', label: 'Package'},
    {key: 'file', label: 'File'},
    {key: 'line', label: 'Line'},
    {key: 'name', label: 'Function'},
  ])

  printTable('Top cyclomatic complexity offenders', cyclomatic.slice(0, 10), [
    {key: 'score', label: 'CC'},
    {key: 'crapZeroCoverage', label: 'CRAP0'},
    {key: 'packageName', label: 'Package'},
    {key: 'file', label: 'File'},
    {key: 'line', label: 'Line'},
    {key: 'name', label: 'Function'},
  ])

  printTable('Lowest maintainability index files', maintainability.slice(0, 10), [
    {key: 'maintainabilityIndex', label: 'MI', format: value => value.toFixed(1)},
    {key: 'volume', label: 'Halstead volume', format: value => value.toFixed(1)},
    {key: 'cyclomatic', label: 'File CC'},
    {key: 'sloc', label: 'SLOC'},
    {key: 'file', label: 'File'},
  ])

  printTable('Boundary profiles', boundaries.boundaryProfiles, [
    {key: 'packageName', label: 'Package'},
    {key: 'boundaryFiles', label: 'Boundary'},
    {key: 'totalFiles', label: 'Files'},
    {key: 'ratio', label: 'Ratio', format: value => value.toFixed(3)},
  ])

  printTable('Subdirectory coupling', boundaries.subdirProfiles, [
    {key: 'packageName', label: 'Package'},
    {key: 'crossSubdirEdges', label: 'Cross'},
    {key: 'internalEdges', label: 'Internal'},
    {key: 'ratio', label: 'Ratio', format: value => value.toFixed(3)},
  ])

  printTable('Boundary pairs', boundaries.pairMetrics, [
    {key: 'pair', label: 'Pair'},
    {key: 'srcFan', label: 'Src'},
    {key: 'tgtFan', label: 'Tgt'},
    {key: 'edgeCount', label: 'Edges'},
    {key: 'density', label: 'Density', format: value => value.toFixed(3)},
    {key: 'treeWidth', label: 'TW'},
    {key: 'bci', label: 'BCI', format: value => value.toFixed(2)},
  ])

  printTable('Runtime fan-in', runtimeFanIn, [
    {key: 'packageName', label: 'Package'},
    {key: 'runtimeSymbols', label: 'Runtime symbols'},
    {key: 'top', label: 'Top symbols', format: value => value.join(', ')},
  ])

  printTable('Top turbulence offenders', turbulence.slice(0, 10), [
    {key: 'turbulence', label: 'Turbulence'},
    {key: 'churn', label: 'Churn'},
    {key: 'complexity', label: 'Complexity'},
    {key: 'packageName', label: 'Package'},
    {key: 'file', label: 'File'},
  ])

  const shouldFail = guards.length > 0 || failingMetrics.length > 0
  if (shouldFail) {
    console.error(`\n✗ Complexity health pressure target not met (${guards.length} guard failure(s), ${failingMetrics.length} pressure axis failure(s)).`)
    console.error('  This is expected until the architecture is improved. Use --report-only for a zero-exit report.')
    if (!REPORT_ONLY) process.exit(1)
    return
  }

  console.log('\n✓ Complexity health pressure target met')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
