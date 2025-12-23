/**
 * electron-builder afterPack hook
 * Updates all file modification times before code signing to satisfy Apple's timestamp validation
 * Only runs on macOS builds (Linux doesn't use .app bundles or code signing)
 */
const { execSync } = require('child_process');
const path = require('path');

module.exports = async function(context) {
  // Only run timestamp updates for macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('⏭️  Skipping timestamp update (not macOS)');
    return;
  }

  const appOutDir = context.appOutDir;
  const appPath = path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`);

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
