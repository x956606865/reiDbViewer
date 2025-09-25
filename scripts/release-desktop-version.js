#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { exit } = require('node:process');

const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/release-desktop-version.js <semver>');
  console.error('Example: node scripts/release-desktop-version.js 0.0.17');
  exit(1);
}

const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
if (!semverPattern.test(version)) {
  console.error(`Invalid version: ${version}`);
  exit(1);
}

const tagName = version.startsWith('desktop-v') ? version : `desktop-v${version}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    const renderedArgs = args.join(' ');
    console.error(`Command failed: ${command} ${renderedArgs}`);
    exit(result.status ?? 1);
  }
}

function runCapture(command, args = []) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (result.status !== 0) {
    const renderedArgs = args.join(' ');
    console.error(`Command failed: ${command} ${renderedArgs}`);
    exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

const status = runCapture('git', ['status', '--porcelain']);
if (status) {
  console.error('Working tree is not clean. Please commit or stash changes before releasing.');
  exit(1);
}

const existingTag = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tagName}`], { stdio: 'ignore' });
if (existingTag.status === 0) {
  console.error(`Tag ${tagName} already exists. Choose a different version.`);
  exit(1);
}

run('node', ['scripts/bump-desktop-version.js', version]);

const postBumpStatus = runCapture('git', ['status', '--porcelain']);
if (!postBumpStatus) {
  console.error('No changes detected after bumping version. Aborting.');
  exit(1);
}

run('git', ['add', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json', 'apps/desktop/src-tauri/Cargo.toml']);

run('git', ['commit', '-m', `chore(desktop): release ${version}`]);

run('git', ['tag', tagName]);

const branch = runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
run('git', ['push', 'origin', branch]);
run('git', ['push', 'origin', '--tags']);

console.log('Desktop release pushed successfully.');
