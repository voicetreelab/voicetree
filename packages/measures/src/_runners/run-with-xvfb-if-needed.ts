#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

function hasDisplay(env) {
  return typeof env.DISPLAY === 'string' && env.DISPLAY.length > 0;
}

function hasCommand(command) {
  const result = spawnSync('command', ['-v', command], {
    shell: true,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function resolveCommand(argv, env, platform) {
  if (argv.length === 0) {
    return {
      command: 'node',
      args: ['-e', 'process.exit(64)'],
      error: 'Usage: run-with-xvfb-if-needed.ts <command> [...args]',
    };
  }

  if (platform !== 'linux' || hasDisplay(env)) {
    return { command: argv[0], args: argv.slice(1) };
  }

  if (!hasCommand('xvfb-run')) {
    return {
      command: 'node',
      args: ['-e', 'process.exit(127)'],
      error: 'Cannot run Electron tests on headless Linux: DISPLAY is unset and xvfb-run is not installed. Run `npx playwright install-deps` first.',
    };
  }

  return {
    command: 'xvfb-run',
    args: ['-a', '--server-args=-screen 0 1280x720x24', ...argv],
  };
}

function run({ command, args: commandArgs, error }) {
  if (error) console.error(error);

  const child = spawn(command, commandArgs, {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (err) => {
    console.error(err.message);
    process.exit(127);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

run(resolveCommand(args, process.env, process.platform));
