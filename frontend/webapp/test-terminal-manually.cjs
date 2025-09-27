// Manual test script for terminal functionality
const { spawn } = require('child_process');
const pty = require('node-pty');

console.log('Testing terminal with node-pty...\n');

// Create a PTY process
const ptyProcess = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : 'bash', [], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  cwd: process.env.HOME,
  env: process.env
});

console.log('Terminal spawned. Type commands and press Enter:');
console.log('Type "exit" to quit\n');

// Handle PTY output
ptyProcess.onData((data) => {
  process.stdout.write(data);
});

// Handle PTY exit
ptyProcess.onExit((exitEvent) => {
  console.log(`\nTerminal exited with code ${exitEvent.exitCode}`);
  process.exit(0);
});

// Handle stdin input
process.stdin.setRawMode(true);
process.stdin.on('data', (data) => {
  // Send input to PTY
  ptyProcess.write(data.toString());

  // Check for Ctrl+C to exit
  if (data[0] === 3) {
    ptyProcess.kill();
    process.exit(0);
  }
});

console.log('Ready for input:\n');