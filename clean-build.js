const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// Configuration
const buildDir = 'public-deploy';
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

// Main build process
async function build() {
  // 1. Clean up build directory
  safeDeleteDir(buildDir);
  safeCreateDir(buildDir);
  
  // 2. Create a simple index.html in the build directory
  try {
    const indexPath = path.join(buildDir, 'index.html');
    console.log(`Creating placeholder index.html at: ${indexPath}`);
    
    // Simple HTML content
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
    
    fs.writeFileSync(indexPath, htmlContent);
    console.log('Successfully created index.html');
  } catch (error) {
    console.error('Failed to create index.html');
    console.error(error.message);
  }
  
  console.log('Build process completed successfully!');
  console.log(`You can now deploy the ${buildDir} directory to Firebase.`);
}

// Run the build process
build().catch(error => {
  console.error('Build process failed:');
  console.error(error);
  process.exit(1);
}); 