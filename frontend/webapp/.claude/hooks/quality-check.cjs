#!/usr/bin/env node
/**
 * Node.js Quality Check Hook
 * Optimized for Node.js TypeScript projects with sensible defaults
 *
 * EXIT CODES:
 *   0 - Success (all checks passed)
 *   1 - General error (missing dependencies, etc.)
 *   2 - Quality issues found - ALL must be fixed (blocking)
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Get project root using CLAUDE_PROJECT_DIR environment variable
 * @returns {string} Project root directory
 */
function getProjectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

const projectRoot = getProjectRoot();

/**
 * Intelligent TypeScript Config Cache with checksum validation
 * Handles multiple tsconfig files and maps files to appropriate configs
 */
class TypeScriptConfigCache {
  /**
   * Creates a new TypeScript config cache instance.
   * Loads existing cache or initializes empty cache.
   */
  constructor() {
    // Store cache in the hook's directory for isolation
    this.cacheFile = path.join(__dirname, 'tsconfig-cache.json');
    this.cache = { hashes: {}, mappings: {} };
    this.loadCache();
  }

  /**
   * Get config hash for cache validation
   * @param {string} configPath - Path to tsconfig file
   * @returns {string} SHA256 hash of config content
   */
  getConfigHash(configPath) {
    try {
      const content = require('fs').readFileSync(configPath, 'utf8');
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (e) {
      return null;
    }
  }

  /**
   * Find all tsconfig files in project
   * @returns {string[]} Array of tsconfig file paths
   */
  findTsConfigFiles() {
    const configs = [];
    try {
      // Try to use glob if available, fallback to manual search
      const globSync = require('glob').sync;
      return globSync('tsconfig*.json', { cwd: projectRoot }).map((file) =>
        path.join(projectRoot, file),
      );
    } catch (e) {
      // Fallback: manually check common config files
      const commonConfigs = [
        'tsconfig.json',
        'tsconfig.webview.json',
        'tsconfig.app.json',
        'tsconfig.test.json',
        'tsconfig.node.json',
      ];

      for (const config of commonConfigs) {
        const configPath = path.join(projectRoot, config);
        if (require('fs').existsSync(configPath)) {
          configs.push(configPath);
        }
      }
      return configs;
    }
  }

  /**
   * Check if cache is valid by comparing config hashes
   * @returns {boolean} True if cache is valid
   */
  isValid() {
    const configFiles = this.findTsConfigFiles();

    // Check if we have the same number of configs
    if (Object.keys(this.cache.hashes).length !== configFiles.length) {
      return false;
    }

    // Check each config hash
    for (const configPath of configFiles) {
      const currentHash = this.getConfigHash(configPath);
      if (currentHash !== this.cache.hashes[configPath]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Rebuild cache by parsing all configs and creating file mappings
   */
  rebuild() {
    this.cache = { hashes: {}, mappings: {} };

    // Process configs in priority order (most specific first)
    const configPriority = [
      'tsconfig.webview.json', // Most specific
      'tsconfig.app.json', // Vite app config
      'tsconfig.test.json', // Test-specific
      'tsconfig.json', // Base config
    ];

    configPriority.forEach((configName) => {
      const configPath = path.join(projectRoot, configName);
      if (!require('fs').existsSync(configPath)) {
        return;
      }

      // Store hash for validation
      this.cache.hashes[configPath] = this.getConfigHash(configPath);

      try {
        // Use TypeScript's config reader to handle comments and extends
        if (ts) {
          const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
          if (configFile.error) {
            // Skip invalid configs
            return;
          }
          const config = configFile.config;

          // Build file pattern mappings
          if (config.include) {
            config.include.forEach((pattern) => {
              // Only set if not already mapped by a more specific config
              if (!this.cache.mappings[pattern]) {
                this.cache.mappings[pattern] = {
                  configPath,
                  excludes: config.exclude || [],
                };
              }
            });
          }
        } else {
          // Fallback to JSON.parse if TypeScript not available
          const configContent = require('fs').readFileSync(configPath, 'utf8');
          const config = JSON.parse(configContent);

          // Build file pattern mappings
          if (config.include) {
            config.include.forEach((pattern) => {
              // Only set if not already mapped by a more specific config
              if (!this.cache.mappings[pattern]) {
                this.cache.mappings[pattern] = {
                  configPath,
                  excludes: config.exclude || [],
                };
              }
            });
          }
        }
      } catch (e) {
        // Skip invalid configs
      }
    });

    this.saveCache();
  }

  /**
   * Load cache from disk
   */
  loadCache() {
    try {
      const cacheContent = require('fs').readFileSync(this.cacheFile, 'utf8');
      this.cache = JSON.parse(cacheContent);
    } catch (e) {
      // Cache doesn't exist or is invalid, will rebuild
      this.cache = { hashes: {}, mappings: {} };
    }
  }

  /**
   * Save cache to disk
   */
  saveCache() {
    try {
      // Save cache directly in hook directory (directory already exists)
      require('fs').writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch (e) {
      // Ignore cache save errors
    }
  }

  /**
   * Get appropriate tsconfig for a file
   * @param {string} filePath - File path to check
   * @returns {string} Path to appropriate tsconfig file
   */
  getTsConfigForFile(filePath) {
    // Ensure cache is valid
    if (!this.isValid()) {
      this.rebuild();
    }

    const relativePath = path.relative(projectRoot, filePath);

    // Check cached mappings first - these are from actual tsconfig includes
    // Sort patterns by specificity to match most specific first
    const sortedMappings = Object.entries(this.cache.mappings).sort(([a], [b]) => {
      // More specific patterns first
      const aSpecificity = a.split('/').length + (a.includes('**') ? 0 : 10);
      const bSpecificity = b.split('/').length + (b.includes('**') ? 0 : 10);
      return bSpecificity - aSpecificity;
    });

    for (const [pattern, mapping] of sortedMappings) {
      // Handle both old format (string) and new format (object with excludes)
      const configPath = typeof mapping === 'string' ? mapping : mapping.configPath;
      const excludes = typeof mapping === 'string' ? [] : mapping.excludes;

      if (this.matchesPattern(relativePath, pattern)) {
        // Check if file is excluded
        let isExcluded = false;
        for (const exclude of excludes) {
          if (this.matchesPattern(relativePath, exclude)) {
            isExcluded = true;
            break;
          }
        }

        if (!isExcluded) {
          return configPath;
        }
      }
    }

    // Fast heuristics for common cases not in cache
    // Webview files
    if (relativePath.includes('src/webview/') || relativePath.includes('/webview/')) {
      const webviewConfig = path.join(projectRoot, 'tsconfig.webview.json');
      if (require('fs').existsSync(webviewConfig)) {
        return webviewConfig;
      }
    }

    // Test files
    if (
      relativePath.includes('/test/') ||
      relativePath.includes('.test.') ||
      relativePath.includes('.spec.')
    ) {
      const testConfig = path.join(projectRoot, 'tsconfig.test.json');
      if (require('fs').existsSync(testConfig)) {
        return testConfig;
      }
    }

    // Default fallback
    return path.join(projectRoot, 'tsconfig.json');
  }

  /**
   * Simple pattern matching for file paths
   * @param {string} filePath - File path to test
   * @param {string} pattern - Glob-like pattern
   * @returns {boolean} True if file matches pattern
   */
  matchesPattern(filePath, pattern) {
    // Simple pattern matching - convert glob to regex
    // Handle the common patterns specially
    if (pattern.endsWith('/**/*')) {
      // For patterns like src/webview/**/* or src/protocol/**/*
      // Match any file under that directory
      const baseDir = pattern.slice(0, -5); // Remove /**/*
      return filePath.startsWith(baseDir);
    }

    // In tsconfig, a pattern like "src" means "src/**/*"
    // Check if this is a simple directory pattern (no wildcards)
    if (!pattern.includes('*') && !pattern.includes('?')) {
      // It's a simple directory path - match any file under it
      return filePath.startsWith(pattern + '/') || filePath === pattern;
    }

    // For other patterns, use regex conversion
    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*\*/g, '🌟') // Temporary placeholder for **
      .replace(/\*/g, '[^/]*') // * matches anything except /
      .replace(/🌟/g, '.*') // ** matches anything including /
      .replace(/\?/g, '.'); // ? matches single character

    const regex = new RegExp(`^${regexPattern}$`);
    const result = regex.test(filePath);

    return result;
  }
}

// Global config cache instance
const tsConfigCache = new TypeScriptConfigCache();

// ANSI color codes
const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[0;33m',
  blue: '\x1b[0;34m',
  cyan: '\x1b[0;36m',
  reset: '\x1b[0m',
};

/**
 * Load configuration from JSON file with environment variable overrides
 * @returns {Object} Configuration object
 */
function loadConfig() {
  let fileConfig = {};

  // Try to load hook-config.json
  try {
    const configPath = path.join(__dirname, 'hook-config.json');
    if (require('fs').existsSync(configPath)) {
      fileConfig = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    // Config file not found or invalid, use defaults
  }

  // Build config with file settings as base, env vars as overrides
  return {
    // TypeScript settings
    typescriptEnabled:
      process.env.CLAUDE_HOOKS_TYPESCRIPT_ENABLED !== undefined
        ? process.env.CLAUDE_HOOKS_TYPESCRIPT_ENABLED !== 'false'
        : (fileConfig.typescript?.enabled ?? true),

    showDependencyErrors:
      process.env.CLAUDE_HOOKS_SHOW_DEPENDENCY_ERRORS !== undefined
        ? process.env.CLAUDE_HOOKS_SHOW_DEPENDENCY_ERRORS === 'true'
        : (fileConfig.typescript?.showDependencyErrors ?? false),

    // ESLint settings
    eslintEnabled:
      process.env.CLAUDE_HOOKS_ESLINT_ENABLED !== undefined
        ? process.env.CLAUDE_HOOKS_ESLINT_ENABLED !== 'false'
        : (fileConfig.eslint?.enabled ?? true),

    eslintAutofix:
      process.env.CLAUDE_HOOKS_ESLINT_AUTOFIX !== undefined
        ? process.env.CLAUDE_HOOKS_ESLINT_AUTOFIX === 'true'
        : (fileConfig.eslint?.autofix ?? false),

    // Prettier settings
    prettierEnabled:
      process.env.CLAUDE_HOOKS_PRETTIER_ENABLED !== undefined
        ? process.env.CLAUDE_HOOKS_PRETTIER_ENABLED !== 'false'
        : (fileConfig.prettier?.enabled ?? true),

    prettierAutofix:
      process.env.CLAUDE_HOOKS_PRETTIER_AUTOFIX !== undefined
        ? process.env.CLAUDE_HOOKS_PRETTIER_AUTOFIX === 'true'
        : (fileConfig.prettier?.autofix ?? false),

    // General settings
    autofixSilent:
      process.env.CLAUDE_HOOKS_AUTOFIX_SILENT !== undefined
        ? process.env.CLAUDE_HOOKS_AUTOFIX_SILENT === 'true'
        : (fileConfig.general?.autofixSilent ?? false),

    debug:
      process.env.CLAUDE_HOOKS_DEBUG !== undefined
        ? process.env.CLAUDE_HOOKS_DEBUG === 'true'
        : (fileConfig.general?.debug ?? false),

    // Ignore patterns
    ignorePatterns: fileConfig.ignore?.patterns || [],

    // Store the full config for rule access
    _fileConfig: fileConfig,
  };
}

/**
 * Hook Configuration
 *
 * Configuration is loaded from (in order of precedence):
 * 1. Environment variables (highest priority)
 * 2. .claude/hooks/config.json file
 * 3. Built-in defaults
 */
const config = loadConfig();

// Logging functions - define before using
const log = {
  info: (msg) => console.error(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  error: (msg) => console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`),
  success: (msg) => console.error(`${colors.green}[OK]${colors.reset} ${msg}`),
  warning: (msg) => console.error(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  debug: (msg) => {
    if (config.debug) {
      console.error(`${colors.cyan}[DEBUG]${colors.reset} ${msg}`);
    }
  },
};

// Note: errors and autofixes are tracked per QualityChecker instance

// Try to load modules, but make them optional
let ESLint, prettier, ts;

try {
  ({ ESLint } = require(path.join(projectRoot, 'node_modules', 'eslint')));
} catch (e) {
  log.debug('ESLint not found in project - will skip ESLint checks');
}

try {
  prettier = require(path.join(projectRoot, 'node_modules', 'prettier'));
} catch (e) {
  log.debug('Prettier not found in project - will skip Prettier checks');
}

try {
  ts = require(path.join(projectRoot, 'node_modules', 'typescript'));
} catch (e) {
  log.debug('TypeScript not found in project - will skip TypeScript checks');
}

/**
 * Quality checker for a single file.
 * Runs TypeScript, ESLint, and Prettier checks with optional auto-fixing.
 */
class QualityChecker {
  /**
   * Creates a new QualityChecker instance.
   * @param {string} filePath - Path to file to check
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.fileType = this.detectFileType(filePath);
    this.errors = [];
    this.autofixes = [];
  }

  /**
   * Detect file type from path
   * @param {string} filePath - File path
   * @returns {string} File type
   */
  detectFileType(filePath) {
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath)) {
      return 'test';
    }
    // MCP transport files
    if (/\/(client|server)\/(stdio|sse|websocket|http)/.test(filePath)) {
      return 'transport';
    }
    // CLI entry points
    if (/\/cli\/|\/bin\/|index\.(ts|js)$/.test(filePath)) {
      return 'cli';
    }
    // Services
    if (/\/services\//.test(filePath)) {
      return 'service';
    }
    if (/\.(ts|tsx)$/.test(filePath)) {
      return 'typescript';
    }
    if (/\.(js|jsx)$/.test(filePath)) {
      return 'javascript';
    }
    return 'unknown';
  }

  /**
   * Run all quality checks
   * @returns {Promise<{errors: string[], autofixes: string[]}>} Check results
   */
  async checkAll() {
    // This should never happen now since we filter out non-source files earlier,
    // but keeping for consistency with shell version
    if (this.fileType === 'unknown') {
      log.info('Unknown file type, skipping detailed checks');
      return { errors: [], autofixes: [] };
    }

    // Run all checks in parallel for speed
    const checkPromises = [];

    if (config.typescriptEnabled) {
      checkPromises.push(this.checkTypeScript());
    }

    if (config.eslintEnabled) {
      checkPromises.push(this.checkESLint());
    }

    if (config.prettierEnabled) {
      checkPromises.push(this.checkPrettier());
    }

    checkPromises.push(this.checkCommonIssues());
    checkPromises.push(this.checkNodePatterns());

    await Promise.all(checkPromises);

    // Check for related tests (not critical, so separate)
    await this.suggestRelatedTests();

    return {
      errors: this.errors,
      autofixes: this.autofixes,
    };
  }

  /**
   * Get file dependencies by parsing imports
   * @param {string} filePath - File to analyze
   * @returns {string[]} Array of file paths including dependencies
   */
  getFileDependencies(filePath) {
    const dependencies = new Set([filePath]);

    try {
      const content = require('fs').readFileSync(filePath, 'utf8');
      const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
      let match;

      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];

        // Only include relative imports (project files)
        if (importPath.startsWith('.')) {
          const resolvedPath = this.resolveImportPath(filePath, importPath);
          if (resolvedPath && require('fs').existsSync(resolvedPath)) {
            dependencies.add(resolvedPath);
          }
        }
      }
    } catch (e) {
      // If we can't parse imports, just use the original file
      log.debug(`Could not parse imports for ${filePath}: ${e.message}`);
    }

    return Array.from(dependencies);
  }

  /**
   * Resolve relative import path to absolute path
   * @param {string} fromFile - File doing the import
   * @param {string} importPath - Relative import path
   * @returns {string|null} Absolute file path or null if not found
   */
  resolveImportPath(fromFile, importPath) {
    const dir = path.dirname(fromFile);
    const resolved = path.resolve(dir, importPath);

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    for (const ext of extensions) {
      const fullPath = resolved + ext;
      if (require('fs').existsSync(fullPath)) {
        return fullPath;
      }
    }

    // Try index files
    for (const ext of extensions) {
      const indexPath = path.join(resolved, 'index' + ext);
      if (require('fs').existsSync(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  /**
   * Check TypeScript compilation
   * @returns {Promise<void>}
   */
  async checkTypeScript() {
    if (!config.typescriptEnabled || !ts) {
      return;
    }

    // Skip TypeScript checking for JavaScript files in hook directories
    if (this.filePath.endsWith('.js') && this.filePath.includes('.claude/hooks/')) {
      log.debug('Skipping TypeScript check for JavaScript hook file');
      return;
    }

    log.info('Running TypeScript compilation check...');

    try {
      // Get intelligent config for this file
      const configPath = tsConfigCache.getTsConfigForFile(this.filePath);

      if (!require('fs').existsSync(configPath)) {
        log.debug(`No TypeScript config found: ${configPath}`);
        return;
      }

      log.debug(
        `Using TypeScript config: ${path.basename(configPath)} for ${path.relative(projectRoot, this.filePath)}`,
      );

      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath),
      );

      // Only check the edited file, not its dependencies
      // Dependencies will be type-checked with their own appropriate configs
      log.debug(`TypeScript checking edited file only`);

      // Create program with just the edited file
      const program = ts.createProgram([this.filePath], parsedConfig.options);
      const diagnostics = ts.getPreEmitDiagnostics(program);

      // Group diagnostics by file
      const diagnosticsByFile = new Map();
      diagnostics.forEach((d) => {
        if (d.file) {
          const fileName = d.file.fileName;
          if (!diagnosticsByFile.has(fileName)) {
            diagnosticsByFile.set(fileName, []);
          }
          diagnosticsByFile.get(fileName).push(d);
        }
      });

      // Report edited file first
      const editedFileDiagnostics = diagnosticsByFile.get(this.filePath) || [];
      if (editedFileDiagnostics.length > 0) {
        this.errors.push(`TypeScript errors in edited file (using ${path.basename(configPath)})`);
        editedFileDiagnostics.forEach((diagnostic) => {
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
          const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
            diagnostic.start,
          );
          console.error(
            `  ❌ ${diagnostic.file.fileName}:${line + 1}:${character + 1} - ${message}`,
          );
        });
      }

      // Report dependencies separately (as warnings, not errors) - only if enabled
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
              const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
                diagnostic.start,
              );
              console.error(`     Line ${line + 1}:${character + 1} - ${message}`);
            });
          }
        });
      }

      if (diagnostics.length === 0) {
        log.success('TypeScript compilation passed');
      }
    } catch (error) {
      log.debug(`TypeScript check error: ${error.message}`);
    }
  }

  /**
   * Check ESLint rules
   * @returns {Promise<void>}
   */
  async checkESLint() {
    if (!config.eslintEnabled || !ESLint) {
      return;
    }

    log.info('Running ESLint...');

    try {
      const eslint = new ESLint({
        fix: config.eslintAutofix,
        cwd: projectRoot,
      });

      const results = await eslint.lintFiles([this.filePath]);
      const result = results[0];

      if (result.errorCount > 0 || result.warningCount > 0) {
        if (config.eslintAutofix) {
          log.warning('ESLint issues found, attempting auto-fix...');

          // Write the fixed output
          if (result.output) {
            await fs.writeFile(this.filePath, result.output);

            // Re-lint to see if issues remain
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
              this.errors.push(
                `ESLint found issues that couldn't be auto-fixed in ${this.filePath}`,
              );
              const formatter = await eslint.loadFormatter('stylish');
              const output = formatter.format(resultsAfterFix);
              console.error(output);
            }
          } else {
            this.errors.push(`ESLint found issues in ${this.filePath}`);
            const formatter = await eslint.loadFormatter('stylish');
            const output = formatter.format(results);
            console.error(output);
          }
        } else {
          this.errors.push(`ESLint found issues in ${this.filePath}`);
          const formatter = await eslint.loadFormatter('stylish');
          const output = formatter.format(results);
          console.error(output);
        }
      } else {
        log.success('ESLint passed');
      }
    } catch (error) {
      log.debug(`ESLint check error: ${error.message}`);
    }
  }

  /**
   * Check Prettier formatting
   * @returns {Promise<void>}
   */
  async checkPrettier() {
    if (!config.prettierEnabled || !prettier) {
      return;
    }

    log.info('Running Prettier check...');

    try {
      const fileContent = await fs.readFile(this.filePath, 'utf8');
      const prettierConfig = await prettier.resolveConfig(this.filePath);

      const isFormatted = await prettier.check(fileContent, {
        ...prettierConfig,
        filepath: this.filePath,
      });

      if (!isFormatted) {
        if (config.prettierAutofix) {
          log.warning('Prettier formatting issues found, auto-fixing...');

          const formatted = await prettier.format(fileContent, {
            ...prettierConfig,
            filepath: this.filePath,
          });

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

  /**
   * Check for common code issues
   * @returns {Promise<void>}
   */
  async checkCommonIssues() {
    log.info('Checking for common issues...');

    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const lines = content.split('\n');
      let foundIssues = false;

      // Check for 'as any' in TypeScript files
      const asAnyRule = config._fileConfig.rules?.asAny || {};
      if (
        (this.fileType === 'typescript' || this.fileType === 'component') &&
        asAnyRule.enabled !== false
      ) {
        lines.forEach((line, index) => {
          if (line.includes('as any')) {
            const severity = asAnyRule.severity || 'error';
            const message =
              asAnyRule.message || 'Prefer proper types or "as unknown" for type assertions';

            if (severity === 'error') {
              this.errors.push(`Found 'as any' usage in ${this.filePath} - ${message}`);
              console.error(`  Line ${index + 1}: ${line.trim()}`);
              foundIssues = true;
            } else {
              // Warning level - just warn, don't block
              log.warning(`'as any' usage at line ${index + 1}: ${message}`);
            }
          }
        });
      }

      // Check for console statements based on React app rules
      const consoleRule = config._fileConfig.rules?.console || {};
      let allowConsole = false;

      // Check if console is allowed in this file
      if (consoleRule.enabled === false) {
        allowConsole = true;
      } else {
        // Check allowed paths
        const allowedPaths = consoleRule.allowIn?.paths || [];
        if (allowedPaths.some((path) => this.filePath.includes(path))) {
          allowConsole = true;
        }

        // Check allowed file types
        const allowedFileTypes = consoleRule.allowIn?.fileTypes || [];
        if (allowedFileTypes.includes(this.fileType)) {
          allowConsole = true;
        }

        // Check allowed patterns
        const allowedPatterns = consoleRule.allowIn?.patterns || [];
        const fileName = path.basename(this.filePath);
        if (
          allowedPatterns.some((pattern) => {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(fileName);
          })
        ) {
          allowConsole = true;
        }
      }

      // For React apps, console is generally allowed but shows as info
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
              // Info level - just warn, don't block
              log.warning(`Console usage at line ${index + 1}: ${message}`);
            }
          }
        });
      }

      // Check for TODO/FIXME comments
      lines.forEach((line, index) => {
        if (/TODO|FIXME/.test(line)) {
          log.warning(`Found TODO/FIXME comment at line ${index + 1}`);
        }
      });

      if (!foundIssues) {
        log.success('No common issues found');
      }
    } catch (error) {
      log.debug(`Common issues check error: ${error.message}`);
    }
  }

  /**
   * Check for Node.js specific patterns and issues
   * @returns {Promise<void>}
   */
  async checkNodePatterns() {
    // Only check TypeScript/JavaScript files
    if (this.fileType === 'unknown') {
      return;
    }

    log.info('Checking Node.js specific patterns...');

    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      let foundIssues = false;

      // Check for unhandled process.exit()
      if (/process\.exit\([^)]*\)/.test(content)) {
        // Check if there are cleanup handlers
        if (
          !/process\.on\(['"]exit['"]/.test(content) &&
          !/process\.on\(['"]SIGINT['"]/.test(content) &&
          !/process\.on\(['"]SIGTERM['"]/.test(content)
        ) {
          log.warning(
            'Found process.exit() without cleanup handlers - consider adding signal handlers',
          );
          foundIssues = true;
        }
      }

      // Check for spawn/exec without error handling
      if (/spawn\(|exec\(|execFile\(|fork\(/.test(content)) {
        // Look for .on('error') in the same file
        if (!/.on\(['"]error['"]/.test(content)) {
          log.warning('Child process spawned without error handling - add .on("error") handler');
          foundIssues = true;
        }
      }

      // Check for stream pipes without error handling
      if (/\.pipe\(/.test(content)) {
        // Count pipes and error handlers
        const pipeCount = (content.match(/\.pipe\(/g) || []).length;
        const errorHandlerCount = (content.match(/\.on\(['"]error['"]/g) || []).length;

        if (pipeCount > 0 && errorHandlerCount < pipeCount) {
          log.warning('Stream pipe without error handling - each pipe should have error handlers');
          foundIssues = true;
        }
      }

      // Check for unhandled promise rejections in main/cli files
      if (this.fileType === 'cli' || /index\.(ts|js)$/.test(this.filePath)) {
        if (
          /new Promise|async|await/.test(content) &&
          !/process\.on\(['"]unhandledRejection['"]/.test(content)
        ) {
          log.warning('Consider adding process.on("unhandledRejection") handler for CLI apps');
        }
      }

      // MCP transport-specific checks
      if (/\/(client|server)\/(stdio|sse|websocket|http)/.test(this.filePath)) {
        if (!content.includes('try') && !content.includes('.catch')) {
          log.warning('Transport implementation should have error handling (try/catch or .catch)');
          foundIssues = true;
        }
      }

      if (!foundIssues) {
        log.success('Node.js patterns look good');
      }
    } catch (error) {
      log.debug(`Node.js patterns check error: ${error.message}`);
    }
  }

  /**
   * Suggest related test files
   * @returns {Promise<void>}
   */
  async suggestRelatedTests() {
    // Skip for test files
    if (this.fileType === 'test') {
      return;
    }

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
      } catch {
        // File doesn't exist, continue
      }
    }

    if (!hasTests) {
      // Check __tests__ directory
      const dir = path.dirname(this.filePath);
      const fileName = path.basename(this.filePath);
      const baseFileName = fileName.replace(/\.[^.]+$/, '');

      for (const ext of testExtensions) {
        try {
          await fs.access(path.join(dir, '__tests__', `${baseFileName}.${ext}`));
          hasTests = true;
          log.warning(`💡 Related test found: __tests__/${baseFileName}.${ext}`);
          log.warning('   Consider running the tests to ensure nothing broke');
          break;
        } catch {
          // File doesn't exist, continue
        }
      }
    }

    if (!hasTests) {
      log.warning(`💡 No test file found for ${path.basename(this.filePath)}`);
      log.warning('   Consider adding tests for better code quality');
    }

    // Special reminders for specific file types
    if (/\/services\//.test(this.filePath)) {
      log.warning('💡 Service file! Consider testing business logic');
    } else if (/\/(client|server)\//.test(this.filePath)) {
      log.warning('💡 Transport file! Consider testing connection handling');
    }
  }
}

/**
 * Parse JSON input from stdin
 * @returns {Promise<Object>} Parsed JSON object
 */
async function parseJsonInput() {
  let inputData = '';

  // Read from stdin
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  if (!inputData.trim()) {
    log.warning('No JSON input provided. This hook expects JSON input from Claude Code.');
    log.info(
      'For testing, provide JSON like: echo \'{"tool_name":"Edit","tool_input":{"file_path":"/path/to/file.ts"}}\' | node hook.js',
    );
    console.error(`\n${colors.yellow}👉 Hook executed but no input to process.${colors.reset}`);
    process.exit(0);
  }

  try {
    return JSON.parse(inputData);
  } catch (error) {
    log.error(`Failed to parse JSON input: ${error.message}`);
    log.debug(`Input was: ${inputData}`);
    process.exit(1);
  }
}

/**
 * Extract file path from tool input
 * @param {Object} input - Tool input object
 * @returns {string|null} File path or null
 */
function extractFilePath(input) {
  const { tool_input } = input;
  if (!tool_input) {
    return null;
  }

  return tool_input.file_path || tool_input.path || tool_input.notebook_path || null;
}

/**
 * Check if file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} True if exists
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if file is a source file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if source file
 */
function isSourceFile(filePath) {
  return /\.(ts|tsx|js|jsx)$/.test(filePath);
}

/**
 * Print summary of errors and autofixes
 * @param {string[]} errors - List of errors
 * @param {string[]} autofixes - List of autofixes
 */
function printSummary(errors, autofixes) {
  // Show auto-fixes if any
  if (autofixes.length > 0) {
    console.error(`\n${colors.blue}═══ Auto-fixes Applied ═══${colors.reset}`);
    autofixes.forEach((fix) => {
      console.error(`${colors.green}✨${colors.reset} ${fix}`);
    });
    console.error(
      `${colors.green}Automatically fixed ${autofixes.length} issue(s) for you!${colors.reset}`,
    );
  }

  // Show errors if any
  if (errors.length > 0) {
    console.error(`\n${colors.blue}═══ Quality Check Summary ═══${colors.reset}`);
    errors.forEach((error) => {
      console.error(`${colors.red}❌${colors.reset} ${error}`);
    });

    console.error(
      `\n${colors.red}Found ${errors.length} issue(s) that MUST be fixed!${colors.reset}`,
    );
    console.error(`${colors.red}════════════════════════════════════════════${colors.reset}`);
    console.error(`${colors.red}❌ ALL ISSUES ARE BLOCKING ❌${colors.reset}`);
    console.error(`${colors.red}════════════════════════════════════════════${colors.reset}`);
    console.error(`${colors.red}Fix EVERYTHING above until all checks are ✅ GREEN${colors.reset}`);
  }
}

/**
 * Main entry point
 * @returns {Promise<void>}
 */
async function main() {
  // Show header with version
  const hookVersion = config._fileConfig.version || '1.0.0';
  console.error('');
  console.error(`📦 Node.js Quality Check v${hookVersion} - Starting...`);
  console.error('────────────────────────────────────────────');

  // Debug: show loaded configuration
  log.debug(`Loaded config: ${JSON.stringify(config, null, 2)}`);

  // Parse input
  const input = await parseJsonInput();
  const filePath = extractFilePath(input);

  if (!filePath) {
    log.warning('No file path found in JSON input. Tool might not be file-related.');
    log.debug(`JSON input was: ${JSON.stringify(input)}`);
    console.error(
      `\n${colors.yellow}👉 No file to check - tool may not be file-related.${colors.reset}`,
    );
    process.exit(0);
  }

  // Check if file exists
  if (!(await fileExists(filePath))) {
    log.info(`File does not exist: ${filePath} (may have been deleted)`);
    console.error(`\n${colors.yellow}👉 File skipped - doesn't exist.${colors.reset}`);
    process.exit(0);
  }

  // For non-source files, exit successfully without checks (matching shell behavior)
  if (!isSourceFile(filePath)) {
    log.info(`Skipping non-source file: ${filePath}`);
    console.error(`\n${colors.yellow}👉 File skipped - not a source file.${colors.reset}`);
    console.error(
      `\n${colors.green}✅ No checks needed for ${path.basename(filePath)}${colors.reset}`,
    );
    process.exit(0);
  }

  // Update header with file name
  console.error('');
  console.error(`🔍 Validating: ${path.basename(filePath)}`);
  console.error('────────────────────────────────────────────');
  log.info(`Checking: ${filePath}`);

  // Run quality checks
  const checker = new QualityChecker(filePath);
  const { errors, autofixes } = await checker.checkAll();

  // Print summary
  printSummary(errors, autofixes);

  // Separate edited file errors from other issues
  const editedFileErrors = errors.filter(
    (e) =>
      e.includes('edited file') ||
      e.includes('ESLint found issues') ||
      e.includes('Prettier formatting issues') ||
      e.includes('console statements') ||
      e.includes("'as any' usage") ||
      e.includes('were auto-fixed'),
  );

  const dependencyWarnings = errors.filter((e) => !editedFileErrors.includes(e));

  // Exit with appropriate code
  if (editedFileErrors.length > 0) {
    // Critical - blocks immediately
    console.error(`\n${colors.red}🛑 FAILED - Fix issues in your edited file! 🛑${colors.reset}`);
    console.error(`${colors.cyan}💡 CLAUDE.md CHECK:${colors.reset}`);
    console.error(
      `${colors.cyan}  → What CLAUDE.md pattern would have prevented this?${colors.reset}`,
    );
    console.error(`${colors.cyan}  → Are you following JSDoc batching strategy?${colors.reset}`);
    console.error(`${colors.yellow}📋 NEXT STEPS:${colors.reset}`);
    console.error(`${colors.yellow}  1. Fix the issues listed above${colors.reset}`);
    console.error(`${colors.yellow}  2. The hook will run again automatically${colors.reset}`);
    console.error(
      `${colors.yellow}  3. Continue with your original task once all checks pass${colors.reset}`,
    );
    process.exit(2);
  } else if (dependencyWarnings.length > 0) {
    // Warning - shows but doesn't block
    console.error(`\n${colors.yellow}⚠️ WARNING - Dependency issues found${colors.reset}`);
    console.error(
      `${colors.yellow}These won't block your progress but should be addressed${colors.reset}`,
    );
    console.error(
      `\n${colors.green}✅ Quality check passed for ${path.basename(filePath)}${colors.reset}`,
    );

    if (autofixes.length > 0 && config.autofixSilent) {
      console.error(
        `\n${colors.yellow}👉 File quality verified. Auto-fixes applied. Continue with your task.${colors.reset}`,
      );
    } else {
      console.error(
        `\n${colors.yellow}👉 File quality verified. Continue with your task.${colors.reset}`,
      );
    }
    process.exit(0); // Don't block on dependency issues
  } else {
    console.error(
      `\n${colors.green}✅ Quality check passed for ${path.basename(filePath)}${colors.reset}`,
    );

    if (autofixes.length > 0 && config.autofixSilent) {
      console.error(
        `\n${colors.yellow}👉 File quality verified. Auto-fixes applied. Continue with your task.${colors.reset}`,
      );
    } else {
      console.error(
        `\n${colors.yellow}👉 File quality verified. Continue with your task.${colors.reset}`,
      );
    }
    process.exit(0);
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  log.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});

// Run main
main().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
