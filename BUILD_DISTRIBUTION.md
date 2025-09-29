# VoiceTree Distribution Build Process & Known Issues

## Build Process Overview

### Prerequisites
- Python 3.13
- Node.js & npm
- UV package manager (`curl -LsSf https://astral.sh/uv/install.sh | sh`)

### Step 1: Build Python Server Executable

```bash
# Clean previous builds
rm -rf dist build

# Create isolated environment and build server
./build_server.sh

# This creates:
# - dist/voicetree-server/voicetree-server (25MB executable)
# - dist/voicetree-server/_internal/ (256MB dependencies after NLTK removal)
```

The server is built without heavy dependencies:
- ❌ NLTK (removed - was 3.3GB with data)
- ❌ PyTorch, TensorFlow, Keras
- ❌ Audio libs (PyAudio, Whisper)
- ✅ ChromaDB (needed for vector store)
- ✅ Scikit-learn (for TF-IDF)
- ✅ Google Gemini API

### Step 2: Build Electron Distribution

```bash
cd frontend/webapp

# Move chokidar to production dependencies (required at runtime)
# Already done in package.json

# Install dependencies
npm install

# Build frontend
npm run build:test  # Skips TypeScript errors

# Create distributable DMG
npx electron-builder --publish=never

# Creates: dist-electron/VoiceTree-0.0.0-arm64.dmg (245MB)
```

## Current Limitations & Issues

### 1. Server Won't Start When App is Double-Clicked (macOS Security)

**Issue**: The Python server fails to start when the Electron app is launched from Finder (double-click), but works when launched from Terminal.

**Root Cause**: macOS security restrictions on unsigned apps:
- Both app and server have `Signature=adhoc` (not properly code-signed)
- macOS prevents unsigned apps from spawning unsigned executables when launched from Finder
- Terminal launches inherit shell permissions and can spawn subprocesses

**Verification**:
```bash
# Check code signatures
codesign -dv dist-electron/mac-arm64/VoiceTree.app
# Shows: Signature=adhoc

# Run from Terminal - WORKS
dist-electron/mac-arm64/VoiceTree.app/Contents/MacOS/VoiceTree
# Server starts successfully on port 8001

# Double-click from Finder - FAILS
# Server silently fails to spawn (no error in UI)
```

**Workarounds**:
1. Launch from Terminal: `open dist-electron/mac-arm64/VoiceTree.app`
2. Start server manually first: `./dist/voicetree-server/voicetree-server 8001`
3. Code sign the app with Developer ID certificate (requires Apple Developer account)

### 2. File Path Bug (FIXED)

**Issue**: File save/delete operations failed with "ENOENT: no such file or directory" errors.

**Error Example**:
```
Error saving content: Error: ENOENT: no such file or directory, open 'Obsidian Vault/2025-08-08/1_2_SubtaskAgent_Implementation.md'
```

**Root Cause - Why Frontend Sends Relative Paths**:

The frontend sends relative paths because:

1. **File Watcher Events**: When chokidar watches a directory, it emits file events with paths relative to the watched directory:
   ```javascript
   // In file-watch-manager.cjs
   this.watcher.on('add', (filePath) => {
     // filePath is relative to watchedDirectory
     // e.g., "2025-08-08/1_2_SubtaskAgent_Implementation.md"
   });
   ```

2. **UI Tree Structure**: The frontend stores and displays files in a tree structure using these relative paths for cleaner presentation. Users see "Obsidian Vault/file.md" not "/Users/username/Documents/Obsidian Vault/file.md"

3. **Graph Node IDs**: The Cytoscape graph uses relative paths as node IDs to keep them consistent and portable

4. **Working Directory Mismatch**: When packaged, the Electron app runs from `/Applications/VoiceTree.app/Contents/MacOS/`, not the watched directory, so relative paths don't resolve correctly

**Fix Applied**:
```javascript
// In electron/electron.cjs
ipcMain.handle('save-file-content', async (event, filePath, content) => {
  try {
    // Convert relative paths to absolute using the watched directory
    let absolutePath = filePath;
    if (!path.isAbsolute(filePath) && fileWatchManager.watchedDirectory) {
      absolutePath = path.join(fileWatchManager.watchedDirectory, filePath);
      console.log(`Converting relative path "${filePath}" to absolute: "${absolutePath}"`);
    }

    await fs.writeFile(absolutePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Error saving file:', error);
    return { success: false, error: error.message };
  }
});
```

### 3. Missing chokidar Module

**Issue**: "Cannot find module 'chokidar'" error when running packaged app.

**Fix**: Move `chokidar` from `devDependencies` to `dependencies` in package.json.

## Final Package Details

- **DMG Size**: 245MB (down from 1.4GB after removing NLTK)
- **Server**: 280MB total (25MB executable + 256MB dependencies)
- **Major Dependencies**:
  - googleapiclient: 88MB
  - chromadb: 44MB
  - scipy: 37MB
  - sklearn: 18MB

## Testing the Distribution

1. **Test from Terminal** (recommended for debugging):
   ```bash
   # Run with logging
   ELECTRON_ENABLE_LOGGING=1 dist-electron/mac-arm64/VoiceTree.app/Contents/MacOS/VoiceTree
   ```

2. **Test Server Separately**:
   ```bash
   # Start server manually
   dist-electron/mac-arm64/VoiceTree.app/Contents/Resources/server/voicetree-server 8001

   # Test health endpoint
   curl http://localhost:8001/health
   ```

3. **Check Logs**:
   - Server logs: `~/Library/Application Support/voicetree-webapp/voicetree_server.log`
   - macOS Console app for system logs

## Future Improvements

1. **Code Signing**: Sign both app and server with Apple Developer ID to fix spawning issue
2. **Alternative Server Packaging**: Consider embedding Python or using a different IPC method
3. **Error Reporting**: Add UI feedback when server fails to start
4. **Path Handling**: Consider having frontend always work with absolute paths internally