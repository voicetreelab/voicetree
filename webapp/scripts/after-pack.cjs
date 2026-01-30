/**
 * electron-builder afterPack hook
 * Updates all file modification times before code signing to satisfy Apple's timestamp validation
 * Only runs on macOS builds (Linux doesn't use .app bundles or code signing)
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function(context) {
  // Only run timestamp updates for macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('⏭️  Skipping after-pack hook (not macOS)');
    return;
  }

  const appOutDir = context.appOutDir;
  const appPath = path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');

  // Replace the server with architecture-specific version using cp -RP (preserves symlinks)
  // We always replace because electron-builder's extraResources copy may not preserve symlinks
  const arch = context.arch; // 1 = x64, 3 = arm64
  const archName = arch === 3 ? 'ARM' : 'Intel';
  const serverSourceDir = arch === 3 ? 'out/resources/server' : 'out/resources-intel/server';
  const serverSource = path.resolve(__dirname, `../../../${serverSourceDir}`);
  const serverDest = path.join(resourcesPath, 'server');

  console.log(`🔄 Installing ${archName} server...`);
  if (!fs.existsSync(serverSource)) {
    throw new Error(`${archName} server not found: ${serverSource}`);
  }

  fs.rmSync(serverDest, { recursive: true, force: true });
  // Use cp -RP to preserve relative symlinks (fs.cpSync converts them to absolute paths)
  execSync(`cp -RP "${serverSource}" "${serverDest}"`, { stdio: 'inherit' });
  console.log(`✅ ${archName} server installed`);

  console.log('🕐 Updating file timestamps before code signing...');
  console.log(`   App path: ${appPath}`);

  try {
    // Touch all files in the app bundle
    execSync(`find "${appPath}" -type f -exec touch {} +`, { stdio: 'inherit' });
    console.log('✅ File timestamps updated successfully');
  } catch (error) {
    console.error('❌ Failed to update timestamps:', error.message);
    throw error;
  }
};
