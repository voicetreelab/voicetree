#!/usr/bin/env node
/**
 * QualityChecker - Runs TypeScript, ESLint, and Prettier checks
 */

const fs = require('fs').promises;
const path = require('path');
const { projectRoot, config, log, ESLint, prettier, ts } = require('./config.cjs');
const tsConfigCache = require('./tsconfig-cache.cjs');

class QualityChecker {
  constructor(filePath) {
    this.filePath = filePath;
    this.fileType = this.detectFileType(filePath);
    this.errors = [];
    this.autofixes = [];
  }

  detectFileType(filePath) {
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath)) return 'test';
    if (/\/(client|server)\/(stdio|sse|websocket|http)/.test(filePath)) return 'transport';
    if (/\/cli\/|\/bin\/|index\.(ts|js)$/.test(filePath)) return 'cli';
    if (/\/services\//.test(filePath)) return 'service';
    if (/\.(ts|tsx)$/.test(filePath)) return 'typescript';
    if (/\.(js|jsx)$/.test(filePath)) return 'javascript';
    return 'unknown';
  }

  async checkAll() {
    if (this.fileType === 'unknown') {
      log.info('Unknown file type, skipping detailed checks');
      return { errors: [], autofixes: [] };
    }

    const checkPromises = [];
    if (config.typescriptEnabled) checkPromises.push(this.checkTypeScript());
    if (config.eslintEnabled) checkPromises.push(this.checkESLint());
    if (config.prettierEnabled) checkPromises.push(this.checkPrettier());
    checkPromises.push(this.checkCommonIssues());
    checkPromises.push(this.checkNodePatterns());

    await Promise.all(checkPromises);
    await this.suggestRelatedTests();

    return { errors: this.errors, autofixes: this.autofixes };
  }

  async checkTypeScript() {
    if (!config.typescriptEnabled || !ts) return;
    if (this.filePath.endsWith('.js') && this.filePath.includes('.claude/hooks/')) {
      log.debug('Skipping TypeScript check for JavaScript hook file');
      return;
    }

    log.info('Running TypeScript compilation check...');

    try {
      const configPath = tsConfigCache.getTsConfigForFile(this.filePath);
      if (!require('fs').existsSync(configPath)) {
        log.debug(`No TypeScript config found: ${configPath}`);
        return;
      }

      log.debug(`Using TypeScript config: ${path.basename(configPath)}`);

      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath),
      );

      const program = ts.createProgram([this.filePath], parsedConfig.options);
      const diagnostics = ts.getPreEmitDiagnostics(program);

      const diagnosticsByFile = new Map();
      diagnostics.forEach((d) => {
        if (d.file) {
          const fileName = d.file.fileName;
          if (!diagnosticsByFile.has(fileName)) diagnosticsByFile.set(fileName, []);
          diagnosticsByFile.get(fileName).push(d);
        }
      });

      const editedFileDiagnostics = diagnosticsByFile.get(this.filePath) || [];
      if (editedFileDiagnostics.length > 0) {
        this.errors.push(`TypeScript errors in edited file (using ${path.basename(configPath)})`);
        editedFileDiagnostics.forEach((diagnostic) => {
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
          const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
          console.error(`  ❌ ${diagnostic.file.fileName}:${line + 1}:${character + 1} - ${message}`);
        });
      }

      if (config.showDependencyErrors) {
        let hasDepErrors = false;
        diagnosticsByFile.forEach((diags, fileName) => {
          if (fileName !== this.filePath) {
            if (!hasDepErrors) {
              console.error('\n[DEPENDENCY ERRORS] Files imported by your edited file:');
              hasDepErrors = true;
            }
            console.error(`  ⚠️ ${fileName}:`);
            diags.forEach((diagnostic) => {
              const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
              const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
              console.error(`     Line ${line + 1}:${character + 1} - ${message}`);
            });
          }
        });
      }

      if (diagnostics.length === 0) log.success('TypeScript compilation passed');
    } catch (error) {
      log.debug(`TypeScript check error: ${error.message}`);
    }
  }

  async checkESLint() {
    if (!config.eslintEnabled || !ESLint) return;

    log.info('Running ESLint...');

    try {
      const eslint = new ESLint({ fix: config.eslintAutofix, cwd: projectRoot });
      const results = await eslint.lintFiles([this.filePath]);
      const result = results[0];

      // Check if file is ignored by ESLint config - this is expected behavior, not an error
      const isIgnoredFile = result.messages.length === 1 &&
        result.messages[0].message &&
        result.messages[0].message.includes('File ignored');

      if (isIgnoredFile) {
        log.success('ESLint passed (file excluded by config)');
        return;
      }

      if (result.errorCount > 0 || result.warningCount > 0) {
        if (config.eslintAutofix && result.output) {
          log.warning('ESLint issues found, attempting auto-fix...');
          await fs.writeFile(this.filePath, result.output);

          const resultsAfterFix = await eslint.lintFiles([this.filePath]);
          const resultAfterFix = resultsAfterFix[0];

          if (resultAfterFix.errorCount === 0 && resultAfterFix.warningCount === 0) {
            log.success('ESLint auto-fixed all issues!');
            if (config.autofixSilent) {
              this.autofixes.push('ESLint auto-fixed formatting/style issues');
            } else {
              this.errors.push('ESLint issues were auto-fixed - verify the changes');
            }
          } else {
            this.errors.push(`ESLint found issues that couldn't be auto-fixed in ${this.filePath}`);
            const formatter = await eslint.loadFormatter('stylish');
            console.error(formatter.format(resultsAfterFix));
          }
        } else {
          this.errors.push(`ESLint found issues in ${this.filePath}`);
          const formatter = await eslint.loadFormatter('stylish');
          console.error(formatter.format(results));
        }
      } else {
        log.success('ESLint passed');
      }
    } catch (error) {
      log.debug(`ESLint check error: ${error.message}`);
    }
  }

  async checkPrettier() {
    if (!config.prettierEnabled || !prettier) return;

    log.info('Running Prettier check...');

    try {
      const fileContent = await fs.readFile(this.filePath, 'utf8');
      const prettierConfig = await prettier.resolveConfig(this.filePath);
      const isFormatted = await prettier.check(fileContent, { ...prettierConfig, filepath: this.filePath });

      if (!isFormatted) {
        if (config.prettierAutofix) {
          log.warning('Prettier formatting issues found, auto-fixing...');
          const formatted = await prettier.format(fileContent, { ...prettierConfig, filepath: this.filePath });
          await fs.writeFile(this.filePath, formatted);
          log.success('Prettier auto-formatted the file!');

          if (config.autofixSilent) {
            this.autofixes.push('Prettier auto-formatted the file');
          } else {
            this.errors.push('Prettier formatting was auto-fixed - verify the changes');
          }
        } else {
          this.errors.push(`Prettier formatting issues in ${this.filePath}`);
          console.error('Run prettier --write to fix');
        }
      } else {
        log.success('Prettier formatting correct');
      }
    } catch (error) {
      log.debug(`Prettier check error: ${error.message}`);
    }
  }

  async checkCommonIssues() {
    log.info('Checking for common issues...');

    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const lines = content.split('\n');
      let foundIssues = false;

      // Check for 'as any'
      const asAnyRule = config._fileConfig.rules?.asAny || {};
      if ((this.fileType === 'typescript' || this.fileType === 'component') && asAnyRule.enabled !== false) {
        lines.forEach((line, index) => {
          if (line.includes('as any')) {
            const severity = asAnyRule.severity || 'error';
            const message = asAnyRule.message || 'Prefer proper types or "as unknown" for type assertions';
            if (severity === 'error') {
              this.errors.push(`Found 'as any' usage in ${this.filePath} - ${message}`);
              console.error(`  Line ${index + 1}: ${line.trim()}`);
              foundIssues = true;
            } else {
              log.warning(`'as any' usage at line ${index + 1}: ${message}`);
            }
          }
        });
      }

      // Check for console statements
      const consoleRule = config._fileConfig.rules?.console || {};
      let allowConsole = consoleRule.enabled === false;

      if (!allowConsole) {
        const allowedPaths = consoleRule.allowIn?.paths || [];
        const allowedFileTypes = consoleRule.allowIn?.fileTypes || [];
        const allowedPatterns = consoleRule.allowIn?.patterns || [];
        const fileName = path.basename(this.filePath);

        allowConsole = allowedPaths.some((p) => this.filePath.includes(p)) ||
          allowedFileTypes.includes(this.fileType) ||
          allowedPatterns.some((pattern) => new RegExp(pattern.replace(/\*/g, '.*')).test(fileName));
      }

      if (!allowConsole && consoleRule.enabled !== false) {
        lines.forEach((line, index) => {
          if (/console\./.test(line)) {
            const severity = consoleRule.severity || 'info';
            const message = consoleRule.message || 'Consider using a logging library';
            if (severity === 'error') {
              this.errors.push(`Found console statements in ${this.filePath} - ${message}`);
              console.error(`  Line ${index + 1}: ${line.trim()}`);
              foundIssues = true;
            } else {
              log.warning(`Console usage at line ${index + 1}: ${message}`);
            }
          }
        });
      }

      // Check for TODO/FIXME
      lines.forEach((line, index) => {
        if (/TODO|FIXME/.test(line)) {
          log.warning(`Found TODO/FIXME comment at line ${index + 1}`);
        }
      });

      if (!foundIssues) log.success('No common issues found');
    } catch (error) {
      log.debug(`Common issues check error: ${error.message}`);
    }
  }

  async checkNodePatterns() {
    if (this.fileType === 'unknown') return;

    log.info('Checking Node.js specific patterns...');

    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      let foundIssues = false;

      if (/process\.exit\([^)]*\)/.test(content)) {
        if (!/process\.on\(['"]exit['"]/.test(content) &&
            !/process\.on\(['"]SIGINT['"]/.test(content) &&
            !/process\.on\(['"]SIGTERM['"]/.test(content)) {
          log.warning('Found process.exit() without cleanup handlers');
          foundIssues = true;
        }
      }

      if (/spawn\(|exec\(|execFile\(|fork\(/.test(content)) {
        if (!/.on\(['"]error['"]/.test(content)) {
          log.warning('Child process spawned without error handling');
          foundIssues = true;
        }
      }

      if (/\.pipe\(/.test(content)) {
        const pipeCount = (content.match(/\.pipe\(/g) || []).length;
        const errorHandlerCount = (content.match(/\.on\(['"]error['"]/g) || []).length;
        if (pipeCount > 0 && errorHandlerCount < pipeCount) {
          log.warning('Stream pipe without error handling');
          foundIssues = true;
        }
      }

      if (this.fileType === 'cli' || /index\.(ts|js)$/.test(this.filePath)) {
        if (/new Promise|async|await/.test(content) &&
            !/process\.on\(['"]unhandledRejection['"]/.test(content)) {
          log.warning('Consider adding process.on("unhandledRejection") handler');
        }
      }

      if (/\/(client|server)\/(stdio|sse|websocket|http)/.test(this.filePath)) {
        if (!content.includes('try') && !content.includes('.catch')) {
          log.warning('Transport implementation should have error handling');
          foundIssues = true;
        }
      }

      if (!foundIssues) log.success('Node.js patterns look good');
    } catch (error) {
      log.debug(`Node.js patterns check error: ${error.message}`);
    }
  }

  async suggestRelatedTests() {
    if (this.fileType === 'test') return;

    const baseName = this.filePath.replace(/\.[^.]+$/, '');
    const testExtensions = ['test.ts', 'test.tsx', 'spec.ts', 'spec.tsx'];
    let hasTests = false;

    for (const ext of testExtensions) {
      try {
        await fs.access(`${baseName}.${ext}`);
        hasTests = true;
        log.warning(`💡 Related test found: ${path.basename(baseName)}.${ext}`);
        log.warning('   Consider running the tests to ensure nothing broke');
        break;
      } catch { /* File doesn't exist */ }
    }

    if (!hasTests) {
      const dir = path.dirname(this.filePath);
      const baseFileName = path.basename(this.filePath).replace(/\.[^.]+$/, '');

      for (const ext of testExtensions) {
        try {
          await fs.access(path.join(dir, '__tests__', `${baseFileName}.${ext}`));
          hasTests = true;
          log.warning(`💡 Related test found: __tests__/${baseFileName}.${ext}`);
          break;
        } catch { /* File doesn't exist */ }
      }
    }

    if (!hasTests) {
      log.warning(`💡 No test file found for ${path.basename(this.filePath)}`);
    }

    if (/\/services\//.test(this.filePath)) {
      log.warning('💡 Service file! Consider testing business logic');
    } else if (/\/(client|server)\//.test(this.filePath)) {
      log.warning('💡 Transport file! Consider testing connection handling');
    }
  }
}

module.exports = QualityChecker;
