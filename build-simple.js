const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Temporarily rename the api directory to skip it during build
const apiDir = path.join(__dirname, 'src', 'app', 'api');
const apiDirBackup = path.join(__dirname, 'src', 'app', '_api_backup');

if (fs.existsSync(apiDir)) {
  console.log('Temporarily moving API directory...');
  fs.renameSync(apiDir, apiDirBackup);
}

try {
  // Run the build
  console.log('Building without API routes...');
  execSync('npm run build', { stdio: 'inherit' });
  console.log('Build completed successfully!');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
} finally {
  // Restore the api directory
  if (fs.existsSync(apiDirBackup)) {
    console.log('Restoring API directory...');
    fs.renameSync(apiDirBackup, apiDir);
  }
} 