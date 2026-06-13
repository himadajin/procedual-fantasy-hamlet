#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];

const ignoredDirs = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.yml',
  '.yaml',
]);

const assetExtensions = new Set([
  '.avif',
  '.glb',
  '.gltf',
  '.jpg',
  '.jpeg',
  '.ktx2',
  '.png',
  '.svg',
  '.webp',
]);

function addFailure(path, message) {
  failures.push(`${path}: ${message}`);
}

function toPosix(path) {
  return path.split(sep).join('/');
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) files.push(...(await walk(resolve(dir, entry.name))));
    } else if (entry.isFile()) {
      files.push(resolve(dir, entry.name));
    }
  }
  return files;
}

function isProductionSource(rel) {
  return rel.startsWith('src/') && !rel.endsWith('.test.ts') && !rel.endsWith('.test.tsx');
}

function isGenerationSource(rel) {
  return rel.startsWith('src/generation/') && /\.(ts|tsx)$/.test(rel);
}

function isManifest(rel) {
  return rel === 'src/assets/materials/manifest.ts';
}

function checkGenerationBoundary(rel, text) {
  if (!isGenerationSource(rel)) return;

  const forbiddenImports = [
    { pattern: /from\s+['"][^'"]*three[^'"]*['"]/g, label: 'Three.js import' },
    { pattern: /from\s+['"][^'"]*react[^'"]*['"]/g, label: 'React import' },
    { pattern: /from\s+['"][^'"]*assets[^'"]*['"]/g, label: 'asset import' },
  ];

  for (const rule of forbiddenImports) {
    if (rule.pattern.test(text)) {
      addFailure(rel, `generation layer must not contain ${rule.label}`);
    }
  }

  if (/\b(?:window|document)\s*[.\[]/.test(text)) {
    addFailure(rel, 'generation layer must not reference DOM globals');
  }

  if (/\bMath\.random\s*\(/.test(text)) {
    addFailure(rel, 'generation layer must use the seeded RNG, not Math.random');
  }
}

function checkUnfinishedMarkers(rel, text) {
  if (!isProductionSource(rel)) return;

  const marker = /\b(?:TODO|FIXME|XXX)\b/i;
  if (marker.test(text)) {
    addFailure(rel, 'production source contains unfinished-work marker');
  }
}

function checkExternalRuntimeReferences(rel, text) {
  if (!rel.startsWith('src/')) return;

  const externalUrl = /https?:\/\//i;
  if (externalUrl.test(text)) {
    addFailure(rel, 'runtime source must not reference external URLs');
  }
}

function checkAssetReferences(rel, text) {
  if (!rel.startsWith('src/') || isManifest(rel)) return;

  const literalAssetRef =
    /['"`][^'"`]*(?:\.png|\.jpe?g|\.webp|\.avif|\.svg|\.gltf|\.glb|\.ktx2)[^'"`]*['"`]/i;
  if (literalAssetRef.test(text)) {
    addFailure(rel, 'asset files must be referenced through src/assets/materials/manifest.ts');
  }
}

function extractManifestPaths(text) {
  const paths = new Set();
  const pathLiteral = /path:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = pathLiteral.exec(text))) {
    paths.add(match[1]);
  }
  return paths;
}

function checkManifest(manifestText, files) {
  const manifestPaths = extractManifestPaths(manifestText);

  for (const path of manifestPaths) {
    if (/^https?:\/\//i.test(path)) {
      addFailure(
        'src/assets/materials/manifest.ts',
        `asset path must be repository-local: ${path}`,
      );
      continue;
    }
    if (!path.startsWith('/src/assets/')) {
      addFailure(
        'src/assets/materials/manifest.ts',
        `asset path must live under /src/assets/: ${path}`,
      );
      continue;
    }
    if (!existsSync(resolve(root, `.${path}`))) {
      addFailure('src/assets/materials/manifest.ts', `listed asset does not exist: ${path}`);
    }
  }

  for (const file of files) {
    const rel = toPosix(relative(root, file));
    if (!rel.startsWith('src/assets/')) continue;
    if (rel === 'src/assets/materials/manifest.ts') continue;
    if (!assetExtensions.has(extname(rel).toLowerCase())) continue;

    const manifestPath = `/${rel}`;
    if (!manifestPaths.has(manifestPath)) {
      addFailure(rel, 'asset file is not listed in src/assets/materials/manifest.ts');
    }
  }
}

const files = await walk(root);
const textFiles = files.filter((file) => textExtensions.has(extname(file).toLowerCase()));

let manifestText = '';
for (const file of textFiles) {
  const rel = toPosix(relative(root, file));
  const text = await readFile(file, 'utf8');
  if (isManifest(rel)) manifestText = text;

  checkGenerationBoundary(rel, text);
  checkUnfinishedMarkers(rel, text);
  checkExternalRuntimeReferences(rel, text);
  checkAssetReferences(rel, text);
}

if (!manifestText) {
  addFailure('src/assets/materials/manifest.ts', 'material asset manifest is missing');
} else {
  checkManifest(manifestText, files);
}

if (failures.length > 0) {
  console.error('Quality gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Quality gate passed.');
