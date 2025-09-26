#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    const formatted = [command, ...args].join(' ');
    throw new Error(`[prebundle-tauri] Command failed: ${formatted}`);
  }
}

run('pnpm', ['run', 'check:updater-signing']);

if (process.env.SKIP_UI_BUILD === '1') {
  console.log('[prebundle-tauri] SKIP_UI_BUILD=1, skipping pnpm run build:ui');
  process.exit(0);
}

run('pnpm', ['run', 'build:ui']);
