# VoiceTree Frontend

## Architecture

### TextToTreeServer
Converts text input (voice or typed) into a markdown tree structure and keeps a specified folder synchronized with the generated nodes.

**Important:** TextToTreeServer is NOT responsible for reading existing markdown files. File watching and graph visualization of existing markdown files happens independently via `FileWatchHandler` and the frontend renderer.

### Tools Directory
Tools are copied from `/Users/bobbobby/repos/VoiceTree/frontend/webapp/dist/resources/tools` (dev) to `/Users/bobbobby/Library/Application Support/voicetree-webapp/tools`. The copy happens on every app launch in `electron/main.ts` via `setupToolsDirectory()`.

ES LINT FUNCTIONAL 
(npx eslint src/functional_graph --format stylish