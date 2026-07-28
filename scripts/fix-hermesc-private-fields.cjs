#!/usr/bin/env node
/**
 * fix-hermesc-private-fields.js
 *
 * Runs after every `pnpm install` to replace private class field syntax
 * (#field) with plain properties (__priv_field) across all node_modules
 * instances of packages that hermesc (react-native 0.81.x) cannot compile.
 *
 * Why: pnpm creates multiple resolved instances of each package when peer
 * dependencies change (e.g. after patching react-native itself).  The pnpm
 * patch mechanism only covers one specific resolution, so newly created
 * instances arrive unpatched.  This script handles all of them.
 *
 * Packages targeted (those confirmed to use #field in bundled JS):
 *   - react-native          (src/private/ and Libraries/)
 *   - @tanstack/query-core  (build/modern/)
 *   - react-native-reanimated (lib/module/)
 *   - react-native-worklets   (lib/module/)
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PNPM_STORE = path.join(__dirname, '..', 'node_modules', '.pnpm');

// Glob patterns relative to each package root that contain private fields.
const TARGETS = [
  { pkg: 'react-native@0.81',        globs: ['src/private/**/*.js', 'Libraries/**/*.js'] },
  { pkg: '@tanstack+query-core@',     globs: ['build/modern/*.js'] },
  { pkg: 'react-native-reanimated@',  globs: ['lib/module/**/*.js'] },
  { pkg: 'react-native-worklets@',    globs: ['lib/module/**/*.js'] },
];

function transformFile(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');
  if (!/#[a-zA-Z_$]/.test(src)) return false; // nothing to do

  const names = new Set();
  for (const m of src.matchAll(/#([a-zA-Z_$][a-zA-Z0-9_$]*)/g)) names.add(m[1]);

  for (const name of names) {
    const re = new RegExp(`#${name}(?![a-zA-Z0-9_$])`, 'g');
    src = src.replace(re, `__priv_${name}`);
  }
  fs.writeFileSync(filePath, src);
  return true;
}

function findFiles(dir, pattern) {
  // Simple recursive .js finder — avoids needing glob dep.
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findFiles(full, pattern));
    else if (entry.isFile() && entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

let total = 0;

for (const { pkg, globs } of TARGETS) {
  if (!fs.existsSync(PNPM_STORE)) break;
  const pkgDirs = fs.readdirSync(PNPM_STORE).filter(d => d.startsWith(pkg));

  for (const pkgDir of pkgDirs) {
    // Resolve the actual package root inside the pnpm virtual store entry.
    const pkgName = pkg.startsWith('@')
      ? pkg.replace('+', '/').replace(/@[^@]*$/, '')  // @tanstack+query-core@ → @tanstack/query-core
      : pkg.replace(/@[^@]*$/, '');                   // react-native@ → react-native
    const pkgRoot = path.join(PNPM_STORE, pkgDir, 'node_modules', pkgName);

    for (const glob of globs) {
      // Extract base dir from glob (everything before the first *)
      const baseDir = path.join(pkgRoot, glob.split('*')[0]);
      const files = findFiles(baseDir, glob);
      for (const f of files) {
        if (transformFile(f)) {
          console.log(`  fixed: ${f.replace(PNPM_STORE + '/', '')}`);
          total++;
        }
      }
    }
  }
}

console.log(`fix-hermesc-private-fields: ${total} file(s) patched.`);
