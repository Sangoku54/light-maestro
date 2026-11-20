#!/usr/bin/env node
/**
 * VERIFICATION DE RELEASE — les DEUX canaux d'auto-update, depuis l'internet.
 *
 *   node scripts/verify-release.cjs [version]
 *
 * Verifie qu'une version est reellement livree ET proposable a la mise a jour :
 *
 *   1. CANAL GITHUB  (celui que connaissance les versions deja installees :
 *      1.0.43 / 1.0.44 pointent GitHub dans leur app-update.yml embarque) :
 *      - /releases/latest doit pointer sur v<version> ;
 *      - la release doit porter latest.yml + setup.exe + blockmap ;
 *      - le latest.yml distant doit announcing la bonne version et des
 *        sizes/sha512 coherents avec le binaire LOCAL (donc avec celui qui
 *        sera installe).
 *   2. CANAL LWS  (canal principal des versions >= 1.0.45) :
 *      - https://light-maestro.com/download/latest.yml doit repondre 200 ;
 *      - le setup et son blockmap doivent etre telechargeables ;
 *      - la taille annoncee doit correspondre au fichier reellement servi.
 *   3. SITE : les deux boutons de telechargement doivent pointer sur des
 *      fichiers qui repondent 200.
 *
 * Sortie : 0 si tout est OK, 1 sinon (le detail de chaque echec est imprime).
 * A lancer APRES l'upload LWS : c'est le seul moyen de savoir si l'app
 * installée verra la nouvelle version.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = process.argv[2] || pkg.version;

const LWS_BASE = 'https://light-maestro.com/download/';
const GITHUB_REPO = 'Sangoku54/light-maestro'; // l'ancien nom redirige vers le nom actuel
const SETUP_NAME = `Light-Maestro-Setup-${VERSION}.exe`;
const PORTABLE_NAME = `Light-Maestro-${VERSION}.exe`;
const BLOCKMAP_NAME = `${SETUP_NAME}.blockmap`;

let failures = 0;
let warnings = 0;

const ok = (m) => console.log(`  [OK]    ${m}`);
const ko = (m) => { failures++; console.log(`  [ECHEC] ${m}`); };
const warn = (m) => { warnings++; console.log(`  [AVERT] ${m}`); };
const info = (m) => console.log(`           ${m}`);

async function head(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  return { status: res.status, length: Number(res.headers.get('content-length') || 0), url: res.url };
}

async function getText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return { status: res.status, text: '' };
  return { status: res.status, text: await res.text() };
}

function sha512Base64(file) {
  const h = crypto.createHash('sha512');
  h.update(fs.readFileSync(file));
  return h.digest('base64');
}

/** Compare le manifest distant au binaire LOCAL (la source de verite du build). */
function checkManifestAgainstLocal(manifest, label) {
  const localSetup = path.join(ROOT, 'release', SETUP_NAME);
  const entry = manifest?.files?.[0];
  if (!entry) {
    ko(`${label} : le manifest ne declare aucun fichier`);
    return;
  }
  if (manifest.version !== VERSION) {
    ko(`${label} : version annoncee "${manifest.version}" au lieu de "${VERSION}"`);
  } else {
    ok(`${label} : version ${manifest.version}`);
  }
  if (entry.url !== SETUP_NAME) {
    ko(`${label} : le manifest pointe sur "${entry.url}" au lieu de "${SETUP_NAME}"`);
  } else {
    ok(`${label} : fichier "${entry.url}"`);
  }
  if (!fs.existsSync(localSetup)) {
    warn(`${label} : binaire local absent (${localSetup}) — comparaison sha512 impossible`);
    return;
  }
  const localSize = fs.statSync(localSetup).size;
  const localSha = sha512Base64(localSetup);
  if (Number(entry.size) !== localSize) {
    ko(`${label} : taille annoncee ${entry.size} != taille du binaire local ${localSize}`);
  } else {
    ok(`${label} : taille ${localSize} octets identique au binaire local`);
  }
  if (entry.sha512 !== localSha) {
    ko(`${label} : sha512 annonce != sha512 du binaire local (le fichier TELECHARGÉ ne sera pas celui du build)`);
  } else {
    ok(`${label} : sha512 identique au binaire local`);
  }
}

async function checkGithub() {
  console.log('\n=== CANAL GITHUB (versions deja installees : 1.0.43 / 1.0.44) ===');
  try {
    const res = await getText(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (res.status !== 200) {
      ko(`API /releases/latest : HTTP ${res.status}`);
      return;
    }
    const rel = JSON.parse(res.text);
    if (rel.tag_name !== `v${VERSION}`) {
      ko(`/releases/latest pointe sur "${rel.tag_name}" au lieu de "v${VERSION}"`);
    } else {
      ok(`/releases/latest -> ${rel.tag_name}`);
    }
    const names = (rel.assets || []).map((a) => a.name);
    for (const need of ['latest.yml', SETUP_NAME, BLOCKMAP_NAME]) {
      if (names.includes(need)) ok(`asset présent : ${need}`);
      else ko(`asset MANQUANT : ${need} (la MAJ ne peut pas se telecharger)`);
    }
    const manifestRes = await getText(
      `https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/latest.yml`,
    );
    if (manifestRes.status !== 200) {
      ko(`latest.yml distant : HTTP ${manifestRes.status}`);
    } else {
      checkManifestAgainstLocal(yaml.load(manifestRes.text), 'GitHub');
    }
  } catch (e) {
    ko(`canal GitHub injoignable : ${e.message}`);
  }
}

/**
 * Emplacements ou le dossier de telechargement a deja ete pose sur le serveur.
 * L'URL est FIGEE dans le binaire (app-update.yml) ET dans les liens du site :
 * le code attend exactement LWS_BASE. Si les fichiers sont ailleurs, c'est le
 * serveur qu'il faut corriger, pas le code.
 */
const LWS_CANDIDATES = [
  LWS_BASE, // https://light-maestro.com/download/  <-- attendu
  'https://light-maestro.com/downloads/',
  'https://light-maestro.com/dl/',
  'https://light-maestro.com/win/',
  'https://light-maestro.com/download/Win/',
  'https://light-maestro.com/fichiers/',
  'https://light-maestro.com/releases/',
];

let locationDiagnosed = false;

/**
 * Quand le canal principal est en 404, cherche OU sont vraiment les fichiers
 * (le classique : deposes dans « downloads » au lieu de « download »).
 */
async function diagnoseLwsLocation() {
  if (locationDiagnosed) return;
  locationDiagnosed = true;
  console.log('           — ou sont les fichiers ? (sonde des emplacements courants) —');
  let found = 0;
  for (const base of LWS_CANDIDATES) {
    let manifest = null;
    try {
      const res = await fetch(`${base}latest.yml`, { redirect: 'follow' });
      if (!res.ok) {
        console.log(`             ${base.padEnd(48)} latest.yml absent`);
        continue;
      }
      manifest = yaml.load(await res.text());
    } catch {
      console.log(`             ${base.padEnd(48)} injoignable`);
      continue;
    }
    found++;
    const setupName = manifest?.files?.[0]?.url;
    const expected = manifest?.files?.[0]?.size;
    let setupStatus = '?';
    try {
      const h = await head(`${base}${encodeURIComponent(setupName || '')}`);
      setupStatus =
        h.status === 200
          ? `HTTP 200 (${h.length} o${expected && h.length !== Number(expected) ? ' ≠ taille annoncée !' : ''})`
          : `HTTP ${h.status}`;
    } catch {
      setupStatus = 'erreur';
    }
    console.log(`             ${base.padEnd(48)} latest.yml v${manifest?.version} | setup ${setupStatus}`);
  }
  console.log('');
  if (found === 0) {
    console.log('             >>> Aucun latest.yml trouve dans les emplacements connus.');
  } else {
    console.log(`             >>> Le code attend EXACTEMENT : ${LWS_BASE}`);
    console.log('             >>> Action : renommer le dossier du serveur en « download »');
    console.log('             >>> (sans « s »), ou re-deposer les 4 fichiers dans ce dossier-la.');
    console.log('             >>> Ne PAS changer l URL dans le code : elle est figee dans');
    console.log('             >>> les binaires installes (1.0.45 / 1.0.46) ET dans les');
    console.log('             >>> liens du site -> les versions deja installees ne verraient');
    console.log('             >>> plus aucune mise a jour.');
  }
}

async function checkLws() {
  console.log('\n=== CANAL LWS (canal principal des versions >= 1.0.45) ===');
  const manifestRes = await getText(`${LWS_BASE}latest.yml`);
  if (manifestRes.status !== 200) {
    ko(`latest.yml : HTTP ${manifestRes.status} — le canal principal est INACTIF (upload LWS non fait ?)`);
    ko(`  les versions >= 1.0.45 ne proposeront aucune MAJ tant que ce fichier est absent`);
    await diagnoseLwsLocation();
    return;
  }
  ok(`latest.yml : HTTP 200`);
  const manifest = yaml.load(manifestRes.text);
  checkManifestAgainstLocal(manifest, 'LWS');

  for (const [name, expected] of [
    [SETUP_NAME, manifest?.files?.[0]?.size],
    [BLOCKMAP_NAME, null],
    [PORTABLE_NAME, null],
  ]) {
    try {
      const h = await head(`${LWS_BASE}${encodeURIComponent(name)}`);
      if (h.status !== 200) {
        ko(`${name} : HTTP ${h.status} — fichier absent ou inaccessible`);
      } else if (expected && h.length !== Number(expected)) {
        ko(`${name} : ${h.length} octets servis != ${expected} annonces (fichier tronque ?)`);
      } else {
        ok(`${name} : HTTP 200${h.length ? ` (${h.length} octets)` : ''}`);
      }
    } catch (e) {
      ko(`${name} : erreur ${e.message}`);
    }
  }
}

/**
 * SITE : les PAGES reellement en ligne, pas seulement les URL des boutons.
 *
 * Piege couvert : un utilisateur peut deposer les 4 fichiers dans /download/
 * et oublier de re-uploader telecharger.html. La page en ligne continue
 * alors d'annoncer l'ancienne version et ses boutons pointent vers des
 * fichiers absents -> boutons CASSES alors que les fichiers sont la.
 * On verifie donc :
 *   1. la version APP_VERSION annoncee par la page en ligne ;
 *   2. le SHA256 affiche sur la page = SHA256 du binaire local ;
 *   3. les 2 URL de telechargement repondent 200.
 */
async function checkSite() {
  console.log('\n=== SITE (pages de telechargement EN LIGNE) ===');
  const localSetup = path.join(ROOT, 'release', SETUP_NAME);
  const localPortable = path.join(ROOT, 'release', PORTABLE_NAME);
  const sha256 = (f) =>
    fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').toUpperCase() : null;

  for (const page of ['telecharger.html', 'telecharger-en.html']) {
    const url = `https://light-maestro.com/${page}`;
    const res = await getText(url);
    if (res.status !== 200) {
      ko(`${page} : HTTP ${res.status} — page introuvable sur le serveur`);
      continue;
    }
    const html = res.text;

    const vm = html.match(/APP_VERSION\s*=\s*'([^']+)'/);
    if (!vm) {
      ko(`${page} : APP_VERSION introuvable dans la page en ligne`);
    } else if (vm[1] !== VERSION) {
      ko(`${page} : la page EN LIGNE annonce v${vm[1]} au lieu de v${VERSION} — il faut re-uploader la page`);
    } else {
      ok(`${page} : version ${vm[1]}`);
    }

    // SHA256 affiches dans la page vs binaire local.
    const displayed = [...html.matchAll(/SHA256\s*:\s*([0-9A-Fa-f]{64})/g)].map((m) => m[1].toUpperCase());
    const expected = [sha256(localPortable), sha256(localSetup)].filter(Boolean);
    if (displayed.length === 0) {
      ko(`${page} : aucun SHA256 affiche sur la page`);
    } else if (expected.length && !expected.every((e) => displayed.includes(e))) {
      ko(`${page} : le SHA256 affiche ne correspond pas au binaire local (page obsolete ?)`);
    } else {
      ok(`${page} : SHA256 affiches conformes aux binaires locaux`);
    }

    // Les 2 boutons pointent sur /download/<fichier> : ils doivent repondre.
    for (const name of [PORTABLE_NAME, SETUP_NAME]) {
      try {
        const h = await head(`${LWS_BASE}${encodeURIComponent(name)}`);
        if (h.status === 200) ok(`bouton « ${name} » : HTTP 200`);
        else {
          ko(`bouton « ${name} » : HTTP ${h.status} (le bouton du site est CASSE)`);
          await diagnoseLwsLocation();
        }
      } catch (e) {
        ko(`bouton « ${name} » : erreur ${e.message}`);
      }
    }
  }
}

(async () => {
  console.log(`\n=== VERIFICATION DE RELEASE ${VERSION} ===`);
  console.log(`LWS   : ${LWS_BASE}`);
  console.log(`GitHub: ${GITHUB_REPO}`);
  await checkGithub();
  await checkLws();
  await checkSite();
  console.log('');
  if (failures === 0) {
    console.log(`RESULTAT : OK — la version ${VERSION} est livree sur les deux canaux.`);
    console.log('         Une version deja installee doit proposer la mise a jour au redemarrage.');
  } else {
    console.log(`RESULTAT : ${failures} ECHEC(s), ${warnings} avertissement(s).`);
    console.log('         La mise a jour automatique NE SERA PAS proposee tant que ce n\'est pas corrige.');
  }
  process.exit(failures === 0 ? 0 : 1);
})();
