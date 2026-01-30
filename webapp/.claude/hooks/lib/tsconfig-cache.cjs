#!/usr/bin/env node
/**
 * TypeScript Config Cache - Intelligent tsconfig file mapping
 */

const path = require('path');
const crypto = require('crypto');
const { projectRoot, log, ts } = require('./config.cjs');

class TypeScriptConfigCache {
  constructor() {
    this.cacheFile = path.join(__dirname, '..', 'tsconfig-cache.json');
    this.cache = { hashes: {}, mappings: {} };
    this.loadCache();
  }

  getConfigHash(configPath) {
    try {
      const content = require('fs').readFileSync(configPath, 'utf8');
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (e) {
      return null;
    }
  }

  findTsConfigFiles() {
    const configs = [];
    try {
      const globSync = require('glob').sync;
      return globSync('tsconfig*.json', { cwd: projectRoot }).map((file) =>
        path.join(projectRoot, file),
      );
    } catch (e) {
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

  isValid() {
    const configFiles = this.findTsConfigFiles();
    if (Object.keys(this.cache.hashes).length !== configFiles.length) {
      return false;
    }
    for (const configPath of configFiles) {
      const currentHash = this.getConfigHash(configPath);
      if (currentHash !== this.cache.hashes[configPath]) {
        return false;
      }
    }
    return true;
  }

  rebuild() {
    this.cache = { hashes: {}, mappings: {} };
    const configPriority = [
      'tsconfig.webview.json',
      'tsconfig.app.json',
      'tsconfig.test.json',
      'tsconfig.json',
    ];

    configPriority.forEach((configName) => {
      const configPath = path.join(projectRoot, configName);
      if (!require('fs').existsSync(configPath)) return;

      this.cache.hashes[configPath] = this.getConfigHash(configPath);

      try {
        let config;
        if (ts) {
          const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
          if (configFile.error) return;
          config = configFile.config;
        } else {
          const configContent = require('fs').readFileSync(configPath, 'utf8');
          config = JSON.parse(configContent);
        }

        if (config.include) {
          config.include.forEach((pattern) => {
            if (!this.cache.mappings[pattern]) {
              this.cache.mappings[pattern] = {
                configPath,
                excludes: config.exclude || [],
              };
            }
          });
        }
      } catch (e) {
        // Skip invalid configs
      }
    });

    this.saveCache();
  }

  loadCache() {
    try {
      const cacheContent = require('fs').readFileSync(this.cacheFile, 'utf8');
      this.cache = JSON.parse(cacheContent);
    } catch (e) {
      this.cache = { hashes: {}, mappings: {} };
    }
  }

  saveCache() {
    try {
      require('fs').writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch (e) {
      // Ignore cache save errors
    }
  }

  getTsConfigForFile(filePath) {
    if (!this.isValid()) {
      this.rebuild();
    }

    const relativePath = path.relative(projectRoot, filePath);
    const sortedMappings = Object.entries(this.cache.mappings).sort(([a], [b]) => {
      const aSpecificity = a.split('/').length + (a.includes('**') ? 0 : 10);
      const bSpecificity = b.split('/').length + (b.includes('**') ? 0 : 10);
      return bSpecificity - aSpecificity;
    });

    for (const [pattern, mapping] of sortedMappings) {
      const configPath = typeof mapping === 'string' ? mapping : mapping.configPath;
      const excludes = typeof mapping === 'string' ? [] : mapping.excludes;

      if (this.matchesPattern(relativePath, pattern)) {
        let isExcluded = false;
        for (const exclude of excludes) {
          if (this.matchesPattern(relativePath, exclude)) {
            isExcluded = true;
            break;
          }
        }
        if (!isExcluded) return configPath;
      }
    }

    // Fallback heuristics
    if (relativePath.includes('src/webview/') || relativePath.includes('/webview/')) {
      const webviewConfig = path.join(projectRoot, 'tsconfig.webview.json');
      if (require('fs').existsSync(webviewConfig)) return webviewConfig;
    }

    if (
      relativePath.includes('/test/') ||
      relativePath.includes('.test.') ||
      relativePath.includes('.spec.')
    ) {
      const testConfig = path.join(projectRoot, 'tsconfig.test.json');
      if (require('fs').existsSync(testConfig)) return testConfig;
    }

    return path.join(projectRoot, 'tsconfig.json');
  }

  matchesPattern(filePath, pattern) {
    if (pattern.endsWith('/**/*')) {
      const baseDir = pattern.slice(0, -5);
      return filePath.startsWith(baseDir);
    }

    if (!pattern.includes('*') && !pattern.includes('?')) {
      return filePath.startsWith(pattern + '/') || filePath === pattern;
    }

    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '🌟')
      .replace(/\*/g, '[^/]*')
      .replace(/🌟/g, '.*')
      .replace(/\?/g, '.');

    return new RegExp(`^${regexPattern}$`).test(filePath);
  }
}

// Export singleton instance
module.exports = new TypeScriptConfigCache();
