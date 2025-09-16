#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];

if (!newVersion) {
  console.error('Usage: node scripts/bump-desktop-version.js <version>');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(newVersion)) {
  console.error(`Invalid version: ${newVersion}`);
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');

const filesToUpdate = {
  'apps/desktop/package.json': updatePackageJson,
  'apps/desktop/src-tauri/tauri.conf.json': updateTauriConfig,
  'apps/desktop/src-tauri/Cargo.toml': updateCargoToml,
};

Object.entries(filesToUpdate).forEach(([relativePath, updater]) => {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    console.warn(`Skip missing file: ${relativePath}`);
    return;
  }
  const original = fs.readFileSync(absolutePath, 'utf8');
  const updated = updater(original);
  if (original === updated) {
    console.warn(`No version change applied for: ${relativePath}`);
    return;
  }
  fs.writeFileSync(absolutePath, updated);
  console.log(`Updated ${relativePath}`);
});

function updatePackageJson(source) {
  const data = JSON.parse(source);
  data.version = newVersion;
  return `${JSON.stringify(data, null, 2)}\n`;
}

function updateTauriConfig(source) {
  const data = JSON.parse(source);
  data.version = newVersion;
  return `${JSON.stringify(data, null, 2)}\n`;
}

function updateCargoToml(source) {
  return source.replace(/^(version\s*=\s*")[^"]+("\s*)$/m, `$1${newVersion}$2`);
}
