# Build script for Voicetree server executable using UV and PyInstaller (Windows)
# Usage: .\scripts\build_server_windows.ps1

$ErrorActionPreference = "Stop"

Write-Host "Building Voicetree Server Executable (Windows)..."
Write-Host "=================================================="

# Step 1: Create isolated UV environment
Write-Host "Step 1: Creating isolated UV environment..."
uv venv .venv-server --python 3.13 --clear

# Step 2: Install server dependencies
Write-Host "Step 2: Installing server dependencies..."
uv pip install --python .venv-server -r requirements-server.txt

# Step 3: Install PyInstaller in the same environment
Write-Host "Step 3: Installing PyInstaller..."
uv pip install --python .venv-server pyinstaller

# Step 4: Clean previous Windows builds
Write-Host "Step 4: Cleaning previous Windows builds..."
if (Test-Path "out\build-windows") { Remove-Item -Recurse -Force "out\build-windows" }
if (Test-Path "out\dist-windows") { Remove-Item -Recurse -Force "out\dist-windows" }
if (Test-Path "out\resources") { Remove-Item -Recurse -Force "out\resources" }

# Step 5: Build with PyInstaller
Write-Host "Step 5: Building executable with PyInstaller..."
# PyInstaller must run INSIDE the venv to see all dependencies
& ".venv-server\Scripts\python.exe" -m PyInstaller scripts\server.spec --clean --distpath out\dist-windows --workpath out\build-windows

# Step 6: Copy to out/resources
Write-Host "Step 6: Copying executable to out\resources\server..."
New-Item -ItemType Directory -Force -Path "out\resources\server" | Out-Null
Copy-Item -Recurse -Force "out\dist-windows\voicetree-server\*" "out\resources\server\"
Write-Host "Copied to out\resources\server\"

# Step 7: Skip framework fixes (not needed on Windows)
# macOS requires Python.framework symlink structure fixes for code signing
# Windows doesn't have this requirement

# Step 8: Display results
Write-Host ""
Write-Host "Build complete!"
Write-Host "==============="
Write-Host "Server executable built: .\out\dist-windows\voicetree-server\voicetree-server.exe"
Write-Host "Copied to: .\out\resources\server\"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Test standalone server: .\out\dist-windows\voicetree-server\voicetree-server.exe"
Write-Host "  2. Build full app: .\scripts\build_and_package_windows.ps1"
Write-Host ""
Write-Host "The server is now ready to be bundled with the Electron app!"
