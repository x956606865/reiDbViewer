#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PLACEHOLDER = 'REPLACE_WITH_APP_PUBKEY';
const allowUnsigned = String(process.env.ALLOW_UNSIGNED_DESKTOP_BUILD || '').toLowerCase();
if (allowUnsigned === '1' || allowUnsigned === 'true') {
  console.warn('[updater] ALLOW_UNSIGNED_DESKTOP_BUILD set, skipping signing key check.');
  process.exit(0);
}

const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_UPDATER_PRIVATE_KEY;
if (!privateKey || !privateKey.trim()) {
  console.error('[updater] Missing TAURI_SIGNING_PRIVATE_KEY (or legacy TAURI_UPDATER_PRIVATE_KEY).');
  console.error('          Export the private key content, or provide a file path, before building.');
  process.exit(1);
}

const selfDir = dirname(fileURLToPath(import.meta.url));
const tauriConfigPath = join(selfDir, '..', 'src-tauri', 'tauri.conf.json');
let config;
try {
  const raw = readFileSync(tauriConfigPath, 'utf8');
  config = JSON.parse(raw);
} catch (error) {
  console.error(`[updater] Failed to read ${tauriConfigPath}:`, error.message);
  process.exit(1);
}

const pubkeys = [];
if (config?.updater?.pubkey) pubkeys.push(config.updater.pubkey);
if (config?.plugins?.updater?.pubkey) pubkeys.push(config.plugins.updater.pubkey);

if (pubkeys.length === 0) {
  console.error('[updater] No updater pubkey defined in tauri.conf.json (expected at updater.pubkey or plugins.updater.pubkey).');
  process.exit(1);
}

if (pubkeys.some((value) => value === PLACEHOLDER)) {
  console.error('[updater] Public key placeholder still present in tauri.conf.json. Replace it with the generated app.pubkey content.');
  process.exit(1);
}

const inconsistentPubkey = pubkeys.some((value) => value !== pubkeys[0]);
if (inconsistentPubkey) {
  console.error('[updater] updater.pubkey and plugins.updater.pubkey must match. Update tauri.conf.json to keep them in sync.');
  process.exit(1);
}

const normalizedPubkey = pubkeys[0].trim().replace(/\s+/g, '');
const base64Pattern = /^[A-Za-z0-9+/=]+$/;
if (!base64Pattern.test(normalizedPubkey) || normalizedPubkey.length < 40) {
  console.error('[updater] Updater public key should be the base64 string emitted by `tauri signer generate`.');
  console.error('          Please copy the printed public key (usually starting with "RWR"/"RW"), without extra characters.');
  process.exit(1);
}

console.info('[updater] Signing key check passed.');
