# Complete build and package script for VoiceTree with Electron (Windows)
# This script builds the Python server and packages it with the Electron app
#
# Usage: .\scripts\build_and_package_windows.ps1 [-Publish]
#   -Publish  Also publish to GitHub releases after building

param(
    [switch]$Publish
)

$ErrorActionPreference = "Stop"

Write-Host "=========================================="
Write-Host "VoiceTree Complete Build & Package Script (Windows)"
Write-Host "=========================================="
Write-Host ""

# Check we're in the VoiceTree directory
if (-not (Test-Path "server.py")) {
    Write-Host "Error: This script must be run from the VoiceTree root directory" -ForegroundColor Red
    exit 1
}

# Step 1: Build the Python server executable
Write-Host "Step 1: Building Python server executable..."
Write-Host "----------------------------------------------"
& ".\scripts\build_server_windows.ps1"

if (-not (Test-Path "out\resources\server\voicetree-server.exe")) {
    Write-Host "Error: Server build failed or not copied to out\resources\server\" -ForegroundColor Red
    exit 1
}

# Step 1.5: Copy agent tools and backend modules to out/resources
Write-Host ""
Write-Host "Step 1.5: Copying agent tools and backend modules to out\resources..."
Write-Host "----------------------------------------------"

# Copy tools
New-Item -ItemType Directory -Force -Path "out\resources\tools" | Out-Null
Copy-Item -Recurse -Force "tools\*" "out\resources\tools\"
Write-Host "Tools copied to out\resources\tools\"

# Copy backend modules needed by tools
New-Item -ItemType Directory -Force -Path "out\resources\backend" | Out-Null
Copy-Item -Recurse -Force "backend\context_retrieval" "out\resources\backend\"
Copy-Item -Recurse -Force "backend\markdown_tree_manager" "out\resources\backend\"
Copy-Item -Force "backend\__init__.py" "out\resources\backend\"
Copy-Item -Force "backend\types.py" "out\resources\backend\"
Copy-Item -Force "backend\settings.py" "out\resources\backend\"
Copy-Item -Force "backend\logging_config.py" "out\resources\backend\"
Write-Host "Backend modules copied to out\resources\backend\"
Write-Host "   - context_retrieval\"
Write-Host "   - markdown_tree_manager\"
Write-Host "   - types.py, settings.py, logging_config.py"

# Step 2: Navigate to frontend
Write-Host ""
Write-Host "Step 2: Building Electron frontend..."
Write-Host "----------------------------------------------"
Push-Location "frontend\webapp"

try {
    # Step 3: Install dependencies if needed
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing frontend dependencies..."
        npm install
    }

    # Step 4: Rebuild native modules for Electron (node-pty)
    Write-Host "Rebuilding native modules for Electron..."
    npx electron-rebuild

    # Step 5: Build frontend
    Write-Host "Building frontend assets..."
    npm run build:test

    # Step 6: Build distributable
    Write-Host ""
    Write-Host "Step 4: Creating distributable package..."
    Write-Host "----------------------------------------------"
    Write-Host "Building Electron distributable for Windows (this may take a few minutes)..."

    # Clean previous Windows builds
    Pop-Location
    if (Test-Path "out\electron-windows") { Remove-Item -Recurse -Force "out\electron-windows" }
    if (Test-Path "out\electron") { Remove-Item -Recurse -Force "out\electron" }
    Push-Location "frontend\webapp"

    # Load environment variables from .env if it exists
    if (Test-Path ".env") {
        Write-Host "Loading credentials from .env..."
        Get-Content ".env" | ForEach-Object {
            if ($_ -match "^(GH_TOKEN)=(.*)$") {
                [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
            }
        }
    }

    # Build for Windows
    $BuildExitCode = 0
    if ($Publish) {
        Write-Host "Publishing enabled - will upload to GitHub releases"
        npx electron-vite build
        npx electron-builder --win --publish=always --config.directories.output=../../out/electron
        if ($LASTEXITCODE -ne 0) { $BuildExitCode = $LASTEXITCODE }
    } else {
        npx electron-vite build
        npx electron-builder --win --publish=never --config.directories.output=../../out/electron
        if ($LASTEXITCODE -ne 0) { $BuildExitCode = $LASTEXITCODE }
    }

    # Move the output to windows-specific folder
    Pop-Location
    if (Test-Path "out\electron") {
        Rename-Item "out\electron" "out\electron-windows"
    }

    # Exit with original code if build failed
    if ($BuildExitCode -ne 0) {
        Write-Host "Build or publish step failed with exit code $BuildExitCode" -ForegroundColor Red
        exit $BuildExitCode
    }

    Push-Location "frontend\webapp"

    # Step 7: Report results
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "BUILD COMPLETE!" -ForegroundColor Green
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "Artifacts created:"
    Write-Host "  - Python server: ..\..\out\dist-windows\voicetree-server\"
    Write-Host "  - Server in resources: ..\..\out\resources\server\"

    Pop-Location

    if (Test-Path "out\electron-windows") {
        Write-Host "  - Electron app: out\electron-windows\"

        # Find the installer
        $ExeFile = Get-ChildItem -Path "out\electron-windows" -Filter "*.exe" -Recurse | Select-Object -First 1
        if ($ExeFile) {
            Write-Host ""
            Write-Host "Distributable package ready:" -ForegroundColor Green
            Write-Host "   $($ExeFile.FullName)"
            Write-Host ""
            Write-Host "   This installer contains the complete VoiceTree app with integrated server!"
            Write-Host "   Users can install it without needing Python or any dependencies."
        }
    }

    Write-Host ""
    if ($Publish) {
        Write-Host "Published to GitHub releases!"
    } else {
        Write-Host "To publish, run: .\scripts\build_and_package_windows.ps1 -Publish"
    }
    Write-Host ""
    Write-Host "Done!"

} finally {
    # Ensure we return to original directory
    Pop-Location -ErrorAction SilentlyContinue
}
