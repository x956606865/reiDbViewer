#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key?.startsWith('--')) {
      args[key.slice(2)] = value;
      i += 1;
    }
  }
  return args;
}

function stripTagPrefix(ref) {
  if (!ref) return null;
  if (ref.startsWith('refs/tags/')) return ref.replace('refs/tags/', '');
  return ref;
}

function extractFileName(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return path.basename(parsed.pathname);
  } catch {
    return path.basename(url);
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${filePath}: ${error.message}`);
  }
}

async function ensureDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function findUpdaterDirs(rootDir) {
  const result = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const manifestFiles = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      if (entry.isFile() && /^latest.*\.json$/i.test(entry.name)) {
        manifestFiles.push(entry.name);
      } else if (entry.isDirectory()) {
        stack.push(path.join(currentDir, entry.name));
      }
    }

    for (const manifest of manifestFiles) {
      result.push({ dir: currentDir, manifest });
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  const downloadsDir = args.downloads ?? 'dist';
  const outputDir = args.output ?? path.join(downloadsDir, 'updater');
  const profile = args.profile ?? process.env.UPDATE_PROFILE ?? '';
  const repoSlug = args.repo ?? process.env.GITHUB_REPOSITORY;
  const tagName = args.tag ?? stripTagPrefix(process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF);

  if (!repoSlug) {
    throw new Error('Missing repository slug (set GITHUB_REPOSITORY or --repo)');
  }

  if (!tagName) {
    throw new Error('Missing tag name (set GITHUB_REF_NAME/GITHUB_REF or --tag)');
  }

  const entries = await fs.readdir(downloadsDir, { withFileTypes: true });
  const candidateRoots = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('reidbview-desktop-'))
    .map((entry) => path.join(downloadsDir, entry.name));

  const artifactEntryMap = new Map();
  const addEntries = (entriesList) => {
    for (const entry of entriesList) {
      if (!entry) continue;
      const resolvedDir = path.resolve(entry.dir);
      const manifestKey = `${resolvedDir}::${entry.manifest}`;
      if (path.resolve(entry.dir) === path.resolve(outputDir)) continue;
      artifactEntryMap.set(manifestKey, { dir: resolvedDir, manifest: entry.manifest });
    }
  };
  for (const root of candidateRoots) {
    const updaterDirs = await findUpdaterDirs(root);
    addEntries(updaterDirs);
  }

  if (artifactEntryMap.size === 0) {
    const fallbackDirs = await findUpdaterDirs(downloadsDir);
    addEntries(fallbackDirs);
  }

  const artifactDirs = Array.from(artifactEntryMap.values());

  if (artifactDirs.length === 0) {
    throw new Error(`No updater directories found under ${downloadsDir}`);
  }

  const merged = { version: null, pub_date: null, notes: null, platforms: {} };
  const zipSources = new Map();

  for (const { dir: updaterDir, manifest: manifestFile } of artifactDirs) {
    const manifestPath = path.join(updaterDir, manifestFile);
    try {
      const manifest = await readJson(manifestPath);
      const { version, pub_date: pubDate, notes, platforms } = manifest;

      if (!version) throw new Error('manifest missing version');
      if (!platforms || typeof platforms !== 'object' || Object.keys(platforms).length === 0) {
        throw new Error('manifest missing platforms');
      }

      if (!merged.version) {
        merged.version = version;
      } else if (merged.version !== version) {
        throw new Error(`Mismatched version detected: ${merged.version} vs ${version}`);
      }

      if (!merged.pub_date && pubDate) merged.pub_date = pubDate;
      if (!merged.notes && notes) merged.notes = notes;

      for (const [platformKey, platformData] of Object.entries(platforms)) {
        if (merged.platforms[platformKey]) {
          throw new Error(`Duplicate platform entry detected: ${platformKey}`);
        }
        const { url, signature } = platformData;
        if (!url) throw new Error(`Platform ${platformKey} missing url field`);
        if (!signature) throw new Error(`Platform ${platformKey} missing signature`);

        const fileName = extractFileName(url);
        if (!fileName) {
          throw new Error(`Failed to infer file name from url '${url}'`);
        }

        const sourceZip = path.join(updaterDir, fileName);
        try {
          await fs.access(sourceZip);
        } catch {
          throw new Error(`Expected updater payload at ${sourceZip}`);
        }

        const sanitizedPlatform = platformKey.replace(/[^a-z0-9_-]/gi, '-');
        const sanitizedBaseName = fileName.replace(/\s+/g, '-');
        const baseOutputName = sanitizedBaseName.startsWith('updater-')
          ? sanitizedBaseName
          : `updater-${sanitizedBaseName}`;
        const outputFileName = baseOutputName.includes(sanitizedPlatform)
          ? baseOutputName
          : baseOutputName.replace('updater-', `updater-${sanitizedPlatform}-`);

        if (zipSources.has(outputFileName)) {
          throw new Error(`Duplicate updater payload detected for ${outputFileName}`);
        }

        merged.platforms[platformKey] = {
          ...platformData,
          url: `https://github.com/${repoSlug}/releases/download/${tagName}/${outputFileName}`,
        };

        zipSources.set(outputFileName, sourceZip);
      }
    } catch (error) {
      throw new Error(`Failed processing updater manifest in ${manifestPath}: ${error.message}`);
    }
  }

  if (!merged.pub_date) {
    merged.pub_date = new Date().toISOString();
  }

  await ensureDir(outputDir);

  for (const [fileName, sourcePath] of zipSources.entries()) {
    const destination = path.join(outputDir, fileName);
    await fs.copyFile(sourcePath, destination);
  }

  const manifestName = profile ? `latest-${profile}.json` : 'latest.json';
  const manifestPath = path.join(outputDir, manifestName);
  await fs.writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`);

  const copied = Array.from(zipSources.keys())
    .map((file) => ` - ${file}`)
    .join('\n');

  process.stdout.write(
    `Combined manifest written to ${manifestPath}\nIncluded payloads:\n${copied}\n`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
