# Environment Variable Issues - Fixed 2025-10-18

## Problem Summary

When installing VoiceTree on other users' computers, terminals spawned inside the Electron app had two major issues:

1. **Missing PATH entries** - Commands like `claude` and `node` were not found
2. **Wrong OBSIDIAN_VAULT_PATH** - Terminal env showed hardcoded old path instead of current watched directory

## Root Causes

### Issue 1: Missing PATH
**Symptom:**
```bash
myles@Myless-MacBook-Pro tools % claude
command not found: claude

myles@Myless-MacBook-Pro tools % /opt/homebrew/bin/claude
env: node: No such file or directory
```

**Root Cause:**
- When Electron apps are launched via GUI (double-click), they don't inherit the user's shell PATH
- The macOS system gives Electron a minimal PATH: `/usr/bin:/bin:/usr/sbin:/sbin`
- User's shell config files (`.zshrc`, `.bash_profile`) are NOT sourced for GUI apps
- Homebrew bins (`/opt/homebrew/bin`) and other user tools were not in PATH

**Why it worked in dev:**
- Running `npm run electron` from terminal inherited that terminal's full PATH
- Installing on a fresh machine exposed the issue

### Issue 2: Wrong OBSIDIAN_VAULT_PATH
**Symptom:**
```bash
# Logs showed correct value being set:
[TerminalManager] Using vault path: /Users/bobbobby/repos/knowledge/VoiceTree/todo
[TerminalManager] OBSIDIAN_VAULT_PATH in customEnv: /Users/bobbobby/repos/knowledge/VoiceTree/todo

# But terminal showed wrong value:
OBSIDIAN_VAULT_PATH=/Users/bobbobby/repos/VoiceTree/markdownTreeVault
```

**Root Cause:**
- `.zshrc` was calling a secondary script that set `OBSIDIAN_VAULT_PATH` to a hardcoded value
- Even though we passed correct env vars to `pty.spawn()`, zsh sourced `.zshrc` on startup
- `.zshrc` overwrote the environment variables AFTER the PTY spawned

## Solutions Implemented

### Fix 1: Install and use `fix-path` package

**What it does:**
- `fix-path` is an npm package that fixes the PATH for macOS/Linux GUI apps
- When called at Electron app startup, it spawns a login shell temporarily to read the user's actual PATH
- It updates `process.env.PATH` for the entire Electron process

**Implementation:**
```typescript
// frontend/webapp/electron/main.ts
import fixPath from 'fix-path';

// Fix PATH for macOS/Linux GUI apps
// This ensures the Electron process and all child processes have access to
// binaries installed via Homebrew, npm, etc. that are in the user's shell PATH
fixPath();
```

**Benefits:**
- Main Electron process gets correct PATH
- All child processes (backend server, terminals, etc.) inherit the fixed PATH
- Works even if users don't have shell config files (uses system-wide configs)
- One-time fix at app startup

### Fix 2: Move OBSIDIAN_VAULT_PATH setting AFTER extraEnv

**Original buggy code order:**
```typescript
// Set vault path first
customEnv.OBSIDIAN_VAULT_PATH = vaultPath;

// Then apply extraEnv (which could overwrite it)
if (nodeMetadata.extraEnv) {
  Object.assign(customEnv, nodeMetadata.extraEnv);
}
```

**Fixed code order:**
```typescript
// Apply extraEnv first
if (nodeMetadata.extraEnv) {
  Object.assign(customEnv, nodeMetadata.extraEnv);
}

// Then set vault path (overriding any stale values from extraEnv)
const watchedDir = getWatchedDirectory();
const vaultPath = watchedDir || process.cwd();
customEnv.OBSIDIAN_VAULT_PATH = vaultPath;
```

**Why this helps:**
- Ensures our dynamic vault path always wins over any stale values
- `extraEnv` is meant for agent-specific vars, not for overriding system paths

### Fix 3: Clean up shell config to not set OBSIDIAN_VAULT_PATH

**Issue:**
- User's `.zshrc` was calling a secondary script that hardcoded `OBSIDIAN_VAULT_PATH`
- This overwrote the env vars we carefully set in the PTY spawn

**Solution:**
- Remove or update the shell config to not set `OBSIDIAN_VAULT_PATH`
- Let the Electron app be the source of truth for these vars

## What Didn't Work

### Attempt 1: Login shell flag (`-l`)
```typescript
const shellArgs = ['-l'];  // Make it a login shell
pty.spawn(shell, shellArgs, { ... });
```

**Why we tried it:**
- Login shells source profile files (`.zprofile`, `/etc/zprofile`)
- Thought this would give us the full PATH

**Why it failed:**
- Login shells START FRESH with a new environment
- They overwrite the custom env vars we passed to `pty.spawn()`
- Lost `OBSIDIAN_SOURCE_NOTE`, `OBSIDIAN_VAULT_PATH`, etc.

**Lesson learned:**
- Interactive shells (default) source `.zshrc` but preserve parent env
- Login shells (`-l`) create fresh env and source profile files
- We needed to fix the parent (Electron) env, not rely on shell initialization

### Attempt 2: Manually adding common paths to customEnv
```typescript
const commonPaths = ['/opt/homebrew/bin', '/usr/local/bin', ...];
customEnv.PATH = [...commonPaths, existingPath].join(':');
```

**Why we tried it:**
- Thought we could manually construct a good PATH

**Why it failed:**
- Hardcoding paths is fragile (different on Intel vs Apple Silicon Macs)
- Doesn't capture user-specific customizations
- `fix-path` does this better by reading actual user shell

## Files Changed

1. **frontend/webapp/electron/main.ts**
   - Added `import fixPath from 'fix-path'`
   - Call `fixPath()` at top of file (before other imports)

2. **frontend/webapp/electron/terminal-manager.ts**
   - Moved `OBSIDIAN_VAULT_PATH` assignment after `extraEnv` application
   - Made vault path always set from `getWatchedDirectory()` (not just when nodeMetadata exists)
   - Removed login shell flag attempt

3. **frontend/webapp/package.json**
   - Added dependency: `"fix-path": "^4.0.0"`

4. **User's shell config** (external fix)
   - Removed hardcoded `OBSIDIAN_VAULT_PATH` from `.zshrc` scripts

## Testing

**Before fix:**
```bash
# On fresh install
myles@Myless-MacBook-Pro tools % claude
command not found: claude

myles@Myless-MacBook-Pro tools % echo $PATH
/usr/bin:/bin:/usr/sbin:/sbin
```

**After fix:**
```bash
# PATH now includes Homebrew and other user paths
myles@Myless-MacBook-Pro tools % echo $PATH
/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:...

myles@Myless-MacBook-Pro tools % claude
# Works!

# Env vars are correct
OBSIDIAN_VAULT_PATH=/Users/bobbobby/repos/knowledge/VoiceTree/todo
OBSIDIAN_SOURCE_NOTE=3_Three-Liner_Problem_Definition.md
```

## Lessons Learned

1. **GUI apps need PATH fixing** - Always use `fix-path` for Electron apps on macOS/Linux
2. **Shell init order matters** - Interactive shells preserve parent env, login shells don't
3. **Env var precedence** - Set critical dynamic values LAST to ensure they win
4. **Debug with logging** - Log `process.env` before copying, log `customEnv` before spawn
5. **Full restarts needed** - Electron main process changes require full app restart, not just hot reload

## References

- fix-path package: https://www.npmjs.com/package/fix-path
- VS Code has same issue: https://github.com/microsoft/vscode/issues
- Shell initialization order: login vs interactive shells
- node-pty documentation: https://github.com/microsoft/node-pty
