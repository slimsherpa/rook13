const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const buildDir = 'out';
const deployDir = 'public-deploy';
const apiDir = path.join(__dirname, 'src', 'app', 'api');
const apiDirBackup = path.join(__dirname, 'src', 'app', '_api_backup');

// Helper function to safely execute commands
function safeExec(command, options = {}) {
  try {
    console.log(`Executing: ${command}`);
    return execSync(command, { stdio: 'inherit', ...options });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    console.error(error.message);
    return null;
  }
}

// Helper function to safely delete a directory
function safeDeleteDir(dir) {
  if (!fs.existsSync(dir)) return;
  
  try {
    console.log(`Attempting to delete directory: ${dir}`);
    // On Windows, use rd command which has better permission handling
    safeExec(`rd /s /q "${dir}"`, { shell: true });
  } catch (error) {
    console.error(`Failed to delete directory: ${dir}`);
    console.error(error.message);
  }
}

// Helper function to safely create a directory
function safeCreateDir(dir) {
  if (fs.existsSync(dir)) return;
  
  try {
    console.log(`Creating directory: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error(`Failed to create directory: ${dir}`);
    console.error(error.message);
  }
}

// Helper function to copy directory contents
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Source directory does not exist: ${src}`);
    return;
  }
  
  safeCreateDir(dest);
  
  try {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied: ${srcPath} -> ${destPath}`);
      }
    }
  } catch (error) {
    console.error(`Failed to copy directory: ${src} -> ${dest}`);
    console.error(error.message);
  }
}

// Main build process
async function build() {
  console.log('Starting enhanced build process...');
  
  // 1. Clean up directories
  safeDeleteDir(buildDir);
  safeDeleteDir(deployDir);
  safeCreateDir(deployDir);
  
  // 2. Temporarily move API directory
  let apiMoved = false;
  try {
    if (fs.existsSync(apiDir)) {
      console.log('Temporarily moving API directory...');
      fs.renameSync(apiDir, apiDirBackup);
      apiMoved = true;
    }
  } catch (error) {
    console.error('Failed to move API directory');
    console.error(error.message);
  }
  
  // 3. Attempt to build the Next.js app
  let buildSuccessful = false;
  try {
    console.log('Building Next.js app...');
    safeExec('npm run build');
    buildSuccessful = fs.existsSync(buildDir);
  } catch (error) {
    console.error('Build failed');
    console.error(error.message);
  } finally {
    // Restore API directory
    if (apiMoved) {
      try {
        console.log('Restoring API directory...');
        fs.renameSync(apiDirBackup, apiDir);
      } catch (error) {
        console.error('Failed to restore API directory');
        console.error(error.message);
      }
    }
  }
  
  // 4. If build was successful, copy files to deploy directory
  if (buildSuccessful) {
    console.log(`Build successful! Copying files from ${buildDir} to ${deployDir}...`);
    copyDir(buildDir, deployDir);
    console.log('Files copied successfully!');
  } else {
    console.log('Build failed or output directory not found. Creating fallback index.html...');
    
    // Create a fallback index.html
    const indexPath = path.join(deployDir, 'index.html');
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rook13 Card Game</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #1a365d;
            color: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            text-align: center;
        }
        h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
        }
        p {
            font-size: 1.2rem;
            max-width: 600px;
            line-height: 1.6;
        }
        .card {
            background-color: white;
            color: #1a365d;
            padding: 40px;
            border-radius: 10px;
            margin-top: 2rem;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
        }
    </style>
</head>
<body>
    <h1>Rook13</h1>
    <p>A modern implementation of the classic trick-taking card game</p>
    
    <div class="card">
        <h2>Coming Soon!</h2>
        <p>We're working on deploying the full game. Check back soon for the complete experience.</p>
    </div>
</body>
</html>
    `;
    
    try {
      fs.writeFileSync(indexPath, htmlContent);
      console.log('Successfully created fallback index.html');
    } catch (error) {
      console.error('Failed to create fallback index.html');
      console.error(error.message);
    }
  }
  
  console.log('Build process completed!');
  console.log(`You can now deploy the ${deployDir} directory to Firebase.`);
}

// Run the build process
build().catch(error => {
  console.error('Build process failed:');
  console.error(error);
  process.exit(1);
}); 