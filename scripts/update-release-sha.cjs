#!/usr/bin/env node
/**
 * scripts/update-release-sha.cjs
 *
 * Calcule les SHA des EXE buildés et met à jour :
 *   - release/latest.yml         (electron-updater)
 *   - site/telecharger.html      (SHA256 visibles)
 *   - site/telecharger-en.html   (identique en anglais)
 *
 * Usage :  node scripts/update-release-sha.cjs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Chemins des EXE buildés ──────────────────────────────────────────────────
const PORTABLE_EXE = path.resolve(__dirname, '..', 'release', 'Light Maestro 1.0.39.exe');
const SETUP_EXE    = path.resolve(__dirname, '..', 'release', 'Light Maestro Setup 1.0.39.exe');

// ── Utilitaires hash ─────────────────────────────────────────────────────────
function sha512b64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}
function sha256hex(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}
function fsize(filePath) {
  return fs.statSync(filePath).size;
}

// ── Vérifier que les EXE existent ────────────────────────────────────────────
for (const [label, fp] of [['portable', PORTABLE_EXE], ['setup', SETUP_EXE]]) {
  if (!fs.existsSync(fp)) {
    console.error(`[error] ${label} EXE introuvable : ${fp}`);
    process.exit(1);
  }
}

const portable = {
  name: 'Light Maestro 1.0.39.exe',
  s512: sha512b64(PORTABLE_EXE),
  s256: sha256hex(PORTABLE_EXE),
  size: fsize(PORTABLE_EXE),
};
const setup = {
  name: 'Light Maestro Setup 1.0.39.exe',
  s512: sha512b64(SETUP_EXE),
  s256: sha256hex(SETUP_EXE),
  size: fsize(SETUP_EXE),
};

console.log('=== Portable ===');
console.log('  SHA512 :', portable.s512);
console.log('  SHA256 :', portable.s256);
console.log('  Size   :', portable.size, `(${(portable.size / 1024 / 1024).toFixed(1)} MB)`);
console.log('=== Setup  ===');
console.log('  SHA512 :', setup.s512);
console.log('  SHA256 :', setup.s256);
console.log('  Size   :', setup.size, `(${(setup.size / 1024 / 1024).toFixed(1)} MB)`);

// ── 1. Write release/latest.yml ─────────────────────────────────────────────
const now = new Date().toISOString();
const latestYml = [
  `version: 1.0.39`,
  'files:',
  `  - url: ${setup.name}`,
  `    sha512: ${setup.s512}`,
  `    size: ${setup.size}`,
  `  - url: ${portable.name}`,
  `    sha512: ${portable.s512}`,
  `    size: ${portable.size}`,
  `path: ${setup.name}`,
  `sha512: ${setup.s512}`,
  `releaseDate: '${now}'`,
].join('\n') + '\n';

fs.writeFileSync(path.resolve(__dirname, '..', 'release', 'latest.yml'), latestYml, 'utf8');
console.log('\n✅ release/latest.yml mis à jour');

// ── Helpers pour les pages HTML ─────────────────────────────────────────────
// On insère les balises div au bon endroit en repérant le texte existant.

function buildFileCard(name, sha256, sizeMb, lang) {
  const sizeLabel = `${name} • ${sizeMb.toFixed(1)} MB`;
  const shaLabel  = lang === 'fr' ? 'SHA256' : 'SHA256';
  return `          <div class="mono" style="font-size:12px; color:#a1a1aa">${sizeLabel}</div>
          <div class="mono" style="font-size:11px; color:#6b7280; margin-top:4px">${shaLabel} : ${sha256}</div>`;
}

function patchDlPage(htmlPath, lang) {
  let c = fs.readFileSync(htmlPath, 'utf8');

  // Trouver les deux blocs de carte (portable puis setup) et les remplacer.
  // On repère par le titre "Version portable" / "Portable version" ou "Installeur" / "Installer".
  const portableMarker = lang === 'fr'
    ? '<h2 class="h3" style="margin-top:12px; font-size:22px">Version portable</h2>'
    : '<h2 class="h3" style="margin-top:12px; font-size:22px">Portable version</h2>';
  const setupMarker = lang === 'fr'
    ? '<h2 class="h3" style="margin-top:12px; font-size:22px">Installeur Windows</h2>'
    : '<h2 class="h3" style="margin-top:12px; font-size:22px">Windows installer</h2>';

  // Remplacer le bloc portable (de portableMarker jusqu'à l'attribut download du premier <a>)
  const portableRegex = new RegExp(
    `(      <div class="card">.*?${portableMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?)(</div>\\s*</div>)`,
    's'
  );
  // Stratégie plus simple : chercher les placeholders existants et les remplacer précisément
  // par numéro de ligne.

  const lines = c.split('\n');
  let inPortable = false, inSetup = false;
  let portableStart = -1, portableEnd = -1;
  let setupStart = -1, setupEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(portableMarker) || line.includes('Version portable')) inPortable = true;
    if (line.includes(setupMarker) || line.includes('Installeur Windows') || line.includes('Windows installer')) inSetup = true;
    if (inPortable && portableStart === -1) portableStart = i;
    if (inSetup && setupStart === -1) setupStart = i;
    // Fin de carte : ligne contenant </div> suivi d'un </div> sur la ligne suivante (grid-2)
    if (inPortable && portableEnd === -1 && line.trim() === '</div>' && lines[i + 1] && lines[i + 1].trim() === '</div>') {
      portableEnd = i + 1;
      inPortable = false;
    }
    if (inSetup && setupEnd === -1 && line.trim() === '</div>' && lines[i + 1] && lines[i + 1].trim() === '</div>') {
      setupEnd = i + 1;
      inSetup = false;
    }
  }

  if (portableStart === -1 || portableEnd === -1) {
    console.error('[warn] portable card not found in', htmlPath);
  } else {
    const insert = buildFileCard(portable.name, portable.s256, portable.size / 1024 / 1024, lang);
    lines.splice(portableStart, portableEnd - portableStart + 1, insert);
  }
  if (setupStart === -1 || setupEnd === -1) {
    console.error('[warn] setup card not found in', htmlPath);
  } else {
    // Adjust offsets after previous splice
    const off = (portableStart >= 0 && portableEnd >= 0)
      ? (buildFileCard(portable.name, portable.s256, portable.size / 1024 / 1024, lang).split('\n').length - (portableEnd - portableStart + 1))
      : 0;
    const adjStart = Math.max(0, setupStart + off);
    const adjEnd = Math.max(0, setupEnd + off);
    const insert = buildFileCard(setup.name, setup.s256, setup.size / 1024 / 1024, lang);
    lines.splice(adjStart, adjEnd - adjStart + 1, insert);
  }

  fs.writeFileSync(htmlPath, lines.join('\n'), 'utf8');
  console.log(`✅ ${path.basename(htmlPath)} mis à jour`);
}

patchDlPage(path.resolve(__dirname, '..', 'site', 'telecharger.html'), 'fr');
patchDlPage(path.resolve(__dirname, '..', 'site', 'telecharger-en.html'), 'en');

console.log('\n✨ Tout est à jour.\n'
  + '   Upload sur releases.lightmaestro.app/win/ :\n'
  + `   - ${portable.name}  (SHA256: ${portable.s256})\n`
  + `   - ${setup.name}    (SHA256: ${setup.s256})\n`
  + '   Puis commit + push.');
