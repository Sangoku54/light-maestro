#!/usr/bin/env node
/**
 * PUBLICATION DE LA RELEASE GITHUB — un canal, une commande.
 *
 *   node scripts/publish-github-release.cjs [version] [--tag <commit>]
 *
 * Publie la release GitHub qui alimente l'auto-update des versions DEJA
 * INSTALLEES : la 1.0.43 / 1.0.44 embarque `provider: github` dans son
 * app-update.yml, donc elles ne verront JAMAIS le canal LWS.
 *
 * Ce que fait le script (et les pieges qu'il neutralise) :
 *   1. Resout le nom REEL du depot (`GET /repos/<alias>` -> full_name) :
 *      le depot a ete renomme (light-maestro -> 1.0.45) et un POST sur
 *      l'ancien nom suit le 301 -> PowerShell transforme le POST en GET et
 *      NE CREE RIEN (echec silencieux).
 *   2. Pousse le tag `v<version>` s'il manque (sur le commit du build).
 *   3. Cree la release avec l'URL complete `/releases` (un POST sur
 *      `/repos/<owner>/<repo>` ne cree rien) et SANS `target_commitish`
 *      (GitHub refuse un SHA court : 422 invalid) quand le tag existe deja.
 *   4. Verifie la reponse : si `tag_name` est vide, c'est que l'API a
 *      renvoie autre chose qu'une release -> echec explicite.
 *   5. Televerse les assets depuis `release/` : latest.yml, setup .exe,
 *      setup .exe.blockmap, portable .exe.
 *   6. Verifie ce que voit l'app installee : /releases/latest + latest.yml
 *      distant (version, taille, sha512 vs binaire local).
 *
 * Le token n'est JAMAIS dans ce fichier : il est lu dans le Credential
 * Manager via `git credential fill` (le meme credential que `git push`).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--')) || pkg.version;
const tagIndex = args.indexOf('--tag');
const tagCommit = tagIndex >= 0 ? args[tagIndex + 1] : null;

const REPO_ALIAS = 'Sangoku54/light-maestro'; // nom historique : redirige vers le nom actuel
const TAG = `v${version}`;
const RELEASE_DIR = path.join(ROOT, 'release');
const SETUP = `Light-Maestro-Setup-${version}.exe`;
const PORTABLE = `Light-Maestro-${version}.exe`;
const ASSETS = ['latest.yml', SETUP, `${SETUP}.blockmap`, PORTABLE];

let failed = false;
const say = (m) => console.log(m);
const ok = (m) => console.log(`  [OK]    ${m}`);
const ko = (m) => { failed = true; console.log(`  [ECHEC] ${m}`); };

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** Token GitHub — lu dans le Credential Manager, jamais écrit dans le depot. */
let TOKEN = null;

function token() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const m = out.match(/^password=(.*)$/m);
  if (!m) throw new Error('Credential GitHub introuvable (git credential fill)');
  return m[1].trim();
}

async function api(pathname, init = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'light-maestro-release',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corps non JSON */ }
  return { status: res.status, json, text };
}

async function uploadAsset(repo, releaseId, name, file) {
  const url = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;
  const buf = fs.readFileSync(file);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': name.endsWith('.yml') ? 'application/x-yaml' : 'application/octet-stream',
      'Content-Length': String(buf.length),
      'User-Agent': 'light-maestro-release',
    },
    body: buf,
  });
  if (!res.ok) {
    ko(`upload ${name} : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  ok(`upload ${name} (${buf.length} octets)`);
  return true;
}

(async () => {
  say(`\n=== PUBLICATION GITHUB ${version} ===`);
  TOKEN = token();
  ok(`credential GitHub (longueur ${TOKEN.length})`);

  // 1. Nom reel du depot (le nom peut avoir change).
  const repoRes = await api(`/repos/${REPO_ALIAS}`);
  if (repoRes.status !== 200) throw new Error(`depot introuvable : HTTP ${repoRes.status}`);
  const repo = repoRes.json.full_name;
  ok(`depot reel : ${repo} (alias ${REPO_ALIAS})`);
  if (repo !== REPO_ALIAS) say(`           ATTENTION : le depot a ete renomme — le nom historique redirige.`);

  // 2. Tag.
  const localTags = git('tag', '--list', TAG).trim();
  if (!localTags) {
    const target = tagCommit || 'HEAD';
    git(['tag', '-a', TAG, target, '-m', `Light Maestro ${TAG}`]);
    git(['push', 'origin', `refs/tags/${TAG}`]);
    ok(`tag ${TAG} cree et pousse (${target})`);
  } else {
    ok(`tag ${TAG} deja present (sha ${git('rev-list', '-n', '1', TAG).trim().slice(0, 7)})`);
  }

  // 3. Release.
  let release = (await api(`/repos/${repo}/releases/tags/${TAG}`)).json;
  if (!release || !release.tag_name) {
    const body = {
      tag_name: TAG,
      name: version,
      draft: false,
      prerelease: false,
      body: process.env.LM_RELEASE_NOTES || `Light Maestro ${version}`,
    };
    const created = await api(`/repos/${repo}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (created.status >= 300 || !created.json || !created.json.tag_name) {
      ko(`creation de la release : HTTP ${created.status} — ${created.text.slice(0, 300)}`);
      process.exit(1);
    }
    release = created.json;
    ok(`release ${TAG} creee (id ${release.id})`);
    ok(`   ${release.html_url}`);
  } else {
    ok(`release ${TAG} deja presente (id ${release.id})`);
  }

  // 4. Assets.
  const existing = new Set((release.assets || []).map((a) => a.name));
  for (const name of ASSETS) {
    const file = path.join(RELEASE_DIR, name);
    if (!fs.existsSync(file)) { ko(`fichier absent : release/${name}`); continue; }
    if (existing.has(name)) { ok(`asset deja present : ${name}`); continue; }
    await uploadAsset(repo, release.id, name, file);
  }

  // 5. Verification de ce que voit l'app installee.
  const latest = (await api(`/repos/${repo}/releases/latest`)).json;
  if (!latest || latest.tag_name !== TAG) ko(`/releases/latest pointe sur "${latest && latest.tag_name}" au lieu de "${TAG}"`);
  else ok(`/releases/latest -> ${latest.tag_name}`);

  const manifestRes = await fetch(
    `https://github.com/${REPO_ALIAS}/releases/download/${TAG}/latest.yml`,
    { redirect: 'follow' },
  );
  if (!manifestRes.ok) {
    ko(`latest.yml distant : HTTP ${manifestRes.status}`);
  } else {
    const manifest = await manifestRes.text();
    const versionField = (manifest.match(/^version:\s*(.+)$/m) || [])[1];
    const sizeField = (manifest.match(/^\s*size:\s*(\d+)$/m) || [])[1];
    const shaField = (manifest.match(/^\s*sha512:\s*(\S+)$/m) || [])[1];
    if (versionField !== version) ko(`latest.yml distant : version "${versionField}" au lieu de "${version}"`);
    else ok(`latest.yml distant : version ${versionField}`);
    const setupFile = path.join(RELEASE_DIR, SETUP);
    if (fs.existsSync(setupFile)) {
      const buf = fs.readFileSync(setupFile);
      const localSha = crypto.createHash('sha512').update(buf).digest('base64');
      if (Number(sizeField) !== buf.length) ko(`taille annoncee ${sizeField} != ${buf.length}`);
      else ok(`taille ${buf.length} octets conforme`);
      if (shaField !== localSha) ko('sha512 annonce != sha512 du binaire local');
      else ok('sha512 conforme au binaire local');
    }
  }

  say('');
  if (failed) {
    say('RESULTAT : ECHEC — la release n est pas exploitable par l auto-update.');
    process.exit(1);
  }
  say(`RESULTAT : OK — la version ${version} est publiee sur GitHub (${repo}).`);
  say(`         Les versions deja installees (1.0.43 / 1.0.44 / 1.0.45) la proposeront au redemarrage.`);
  say(`         Il reste a deposer les 4 fichiers dans /download/ sur LWS (canal principal).`);
  process.exit(0);
})().catch((e) => {
  console.error(`\nERREUR : ${e.message}`);
  process.exit(1);
});
