const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Helper function to delete directory recursively
function deleteFolderRecursive(directoryPath) {
  if (fs.existsSync(directoryPath)) {
    fs.readdirSync(directoryPath).forEach((file) => {
      const curPath = path.join(directoryPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        // Recursive call
        deleteFolderRecursive(curPath);
      } else {
        // Delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(directoryPath);
  }
}

// Clean up previous build
console.log('Cleaning up previous build...');
deleteFolderRecursive('.next');
deleteFolderRecursive('build');

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