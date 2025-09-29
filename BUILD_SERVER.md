# Building VoiceTree Server

## Prerequisites
- Python 3.13
- UV package manager (`curl -LsSf https://astral.sh/uv/install.sh | sh`)

## Build Server Executable
```bash
./build_server.sh
```

Creates `dist/voicetree-server/voicetree-server` (~280MB total with dependencies)

## Run Standalone
```bash
# Default port 8000
./dist/voicetree-server/voicetree-server

# Custom port
./dist/voicetree-server/voicetree-server 8080

# Custom markdown directory
VOICETREE_MARKDOWN_DIR=/path/to/vault ./dist/voicetree-server/voicetree-server
```

## Package with Electron
```bash
cd frontend/webapp
npm run build:test
npm run electron:dist
```

Creates distributable in `frontend/webapp/dist-electron/`

## Key Files
- `requirements-server.txt` - Minimal deps (no audio/ML frameworks)
- `server.spec` - PyInstaller config (entry point is `server.py` not `main.py`)