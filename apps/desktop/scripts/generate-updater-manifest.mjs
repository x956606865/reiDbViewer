#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key?.startsWith('--')) continue;
    const normalized = key.slice(2);
    const value = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[i + 1];
    args[normalized] = value;
    if (value !== 'true') i += 1;
  }
  return args;
}

function toPlatformBase(segments, fallbackPlatform) {
  const lowered = segments.map((segment) => segment.toLowerCase());
  if (lowered.includes('macos') || lowered.includes('app') && lowered.includes('macos')) return 'darwin';
  if (lowered.includes('nsis') || lowered.includes('msi')) return 'windows';
  if (lowered.includes('appimage') || lowered.includes('deb') || lowered.includes('rpm')) return 'linux';
  if (fallbackPlatform === 'darwin') return 'darwin';
  if (fallbackPlatform === 'win32') return 'windows';
  return 'linux';
}

function normalizeArch(rawArch) {
  const value = (rawArch || '').toLowerCase();
  if (value === 'x64' || value === 'amd64') return 'x86_64';
  if (value === 'arm64' || value === 'aarch64') return 'aarch64';
  if (value === 'x86') return 'x86';
  return value || 'x86_64';
}

function extractArchHint(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes('aarch64') || lower.includes('arm64')) return 'aarch64';
  if (lower.includes('x86_64') || lower.includes('x64') || lower.includes('amd64')) return 'x86_64';
  if (lower.includes('armv7')) return 'armv7';
  if (lower.includes('i686') || lower.includes('x86')) return 'x86';
  return null;
}

function extractArchFromSegments(segments) {
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (lower.includes('universal')) return 'universal';
    if (lower.includes('aarch64') || lower.includes('arm64')) return 'aarch64';
    if (lower.includes('x86_64') || lower.includes('x64') || lower.includes('amd64')) return 'x86_64';
    if (lower.includes('armv7')) return 'armv7';
    if (lower.includes('i686') || lower.includes('x86')) return 'x86';
  }
  return null;
}

function detectKind(base, fileName) {
  const lower = fileName.toLowerCase();
  if (base === 'darwin') {
    if (lower.endsWith('.app.tar.gz') || lower.endsWith('.app.tar.xz')) return 'app-tar';
    if (lower.endsWith('.app.zip')) return 'app-zip';
  }
  if (base === 'windows') {
    if (lower.includes('nsis') && lower.endsWith('.zip')) return 'nsis-zip';
    if (lower.endsWith('.msi.zip')) return 'msi-zip';
    if (lower.endsWith('.msi')) return 'msi';
    if (lower.endsWith('.exe.zip')) return 'exe-zip';
    if (lower.endsWith('.exe')) return 'exe';
  }
  if (base === 'linux') {
    if (lower.includes('appimage')) return 'appimage';
    if (lower.endsWith('.tar.gz')) return 'tar';
    if (lower.endsWith('.deb')) return 'deb';
    if (lower.endsWith('.rpm')) return 'rpm';
  }
  return 'unknown';
}

const PRIORITY_BY_BASE = {
  darwin: ['app-tar', 'app-zip', 'unknown'],
  windows: ['nsis-zip', 'exe-zip', 'msi-zip', 'msi', 'exe', 'unknown'],
  linux: ['appimage', 'tar', 'deb', 'rpm', 'unknown'],
};

function isLikelyUpdaterPayload(fileName) {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tar.xz') ||
    lower.endsWith('.zip') ||
    lower.endsWith('.appimage') ||
    lower.endsWith('.exe') ||
    lower.endsWith('.msi')
  );
}

async function computeSha512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function walkForSignatures(rootDir, onSignature) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'ci-artifacts') continue;
      await walkForSignatures(fullPath, onSignature);
    } else if (entry.isFile() && entry.name.endsWith('.sig')) {
      await onSignature(fullPath);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const bundleRoot = path.resolve(args['bundle-root'] ?? process.env.BUNDLE_ROOT ?? 'apps/desktop/src-tauri/target/release/bundle');
  const configPath = path.resolve(args.config ?? process.env.TAURI_CONFIG ?? 'apps/desktop/src-tauri/tauri.conf.json');
  const configRaw = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(configRaw);
  const version = args.version ?? config.version ?? process.env.npm_package_version;
  if (!version) {
    throw new Error('Failed to determine application version. Pass --version or ensure tauri.conf.json has a version field.');
  }

  const timestamp = args['pub-date'] ?? new Date().toISOString();
  const notes = args.notes ?? null;

  const artifactsByPlatform = new Map();

  await walkForSignatures(bundleRoot, async (signaturePath) => {
    const payloadPath = signaturePath.slice(0, -4);
    try {
      const stat = await fs.stat(payloadPath);
      if (!stat.isFile()) return;
      const fileName = path.basename(payloadPath);
      if (!isLikelyUpdaterPayload(fileName)) return;

      const segments = payloadPath.split(path.sep);
      const archiveSegment = segments.find((segment) => /^macos(-[A-Za-z0-9_]+)?$/.test(segment));
      const archiveSuffix = archiveSegment?.split('-')[1];
      const archiveArchHint = archiveSuffix ? extractArchHint(archiveSuffix) : null;
      const base = toPlatformBase(segments, process.platform);
      const kind = detectKind(base, fileName);
      const archHint =
        extractArchHint(fileName) ??
        archiveArchHint ??
        extractArchFromSegments(segments) ??
        normalizeArch(process.env.TAURI_ENV_ARCH ?? process.arch);
      const platformKey = `${base}-${archHint}`;
      const priorityList = PRIORITY_BY_BASE[base] ?? ['unknown'];
      const current = artifactsByPlatform.get(platformKey);
      const candidate = {
        platformKey,
        kind,
        fileName,
        payloadPath,
        signaturePath,
        size: stat.size,
      };
      if (!current) {
        artifactsByPlatform.set(platformKey, candidate);
        return;
      }
      const currentPriority = priorityList.indexOf(current.kind);
      const candidatePriority = priorityList.indexOf(kind);
      if (candidatePriority === -1) return;
      if (currentPriority === -1 || candidatePriority < currentPriority) {
        artifactsByPlatform.set(platformKey, candidate);
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        throw error;
      }
    }
  });

  if (artifactsByPlatform.size === 0) {
    throw new Error(`No updater payloads found under ${bundleRoot}`);
  }

  for (const artifact of artifactsByPlatform.values()) {
    const signatureContent = (await fs.readFile(artifact.signaturePath, 'utf8')).trim();
    if (!signatureContent) {
      throw new Error(`Signature file ${artifact.signaturePath} is empty`);
    }
    const sha512 = await computeSha512(artifact.payloadPath);
    const manifest = {
      version,
      notes,
      pub_date: timestamp,
      platforms: {
        [artifact.platformKey]: {
          signature: signatureContent,
          url: artifact.fileName,
          sha512,
          size: artifact.size,
        },
      },
    };
    const manifestPath = path.join(path.dirname(artifact.payloadPath), 'latest.json');
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`Generated ${manifestPath} for ${artifact.platformKey} (payload: ${artifact.fileName})\n`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
