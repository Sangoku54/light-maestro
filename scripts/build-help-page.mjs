/**
 * Génère site/aide.html depuis src/components/help/helpContent.tsx
 * (source unique — le site ne duplique jamais le contenu à la main).
 * Usage : node scripts/build-help-page.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SRC = path.join(root, 'src', 'components', 'help', 'helpContent.tsx');
const DEST = path.join(root, 'site', 'aide.html');

const src = fs.readFileSync(SRC, 'utf-8');

// Découpe en blocs de fiches : chaque fiche commence par "  {\n    id: '...'"
const blocks = src.split(/\n  \{\n    id: '/).slice(1);

function strField(block, key) {
  const m = block.match(new RegExp(key + ": '((?:[^'\\\\]|\\\\.)*)'"));
  if (!m) throw new Error(`champ ${key} introuvable`);
  return m[1].replace(/\\'/g, "'");
}

function arrField(block, key) {
  const m = block.match(new RegExp(key + ': \\[([\\s\\S]*?)\\n    \\],'));
  if (!m) throw new Error(`tableau ${key} introuvable`);
  const items = [];
  const re = /'((?:[^'\\\\]|\\\\.)*)'/g;
  let it;
  while ((it = re.exec(m[1])) !== null) items.push(it[1].replace(/\\'/g, "'"));
  return items;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const pages = blocks.map((b) => ({
  id: b.split("',")[0], // le bloc commence par "<id>'," après découpage sur "id: '"
  group: strField(b, 'group'),
  emoji: strField(b, 'emoji'),
  title: strField(b, 'title'),
  pitch: strField(b, 'pitch'),
  steps: arrField(b, 'steps'),
  tips: arrField(b, 'tips'),
  challenge: strField(b, 'challenge'),
}));

const groups = [...new Set(pages.map((p) => p.group))];
console.log(`${pages.length} fiches, ${groups.length} groupes : ${groups.join(' / ')}`);

const navGroups = groups.map((g) => {
  const items = pages
    .filter((p) => p.group === g)
    .map(
      (p) =>
        `<button data-help-nav="${p.id}" style="display:block; width:100%; text-align:left; padding:8px 10px; border-radius:10px; border:1px solid transparent; background:none; color:#d1d5db; font-size:13px; cursor:pointer">\n` +
        `          <span style="margin-right:6px">${esc(p.emoji)}</span>${esc(p.title)}\n` +
        `        </button>`
    )
    .join('\n');
  return (
    `      <div style="margin-bottom:14px">\n` +
    `        <div style="font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#6b7280; margin-bottom:6px">${esc(g)}</div>\n` +
    `${items}\n      </div>`
  );
}).join('\n');

const sections = pages.map((p) => {
  const steps = p.steps.map((s, i) => `            <li style="display:flex; gap:10px; margin-bottom:8px"><span style="flex-shrink:0; width:22px; height:22px; border-radius:999px; background:rgba(139,92,246,.2); border:1px solid rgba(139,92,246,.4); color:#c4b5fd; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center">${i + 1}</span><span>${esc(s)}</span></li>`).join('\n');
  const tips = p.tips.map((t) => `            <li style="margin-bottom:6px">💡 ${esc(t)}</li>`).join('\n');
  return (
    `    <article class="card chapter" id="aide-${p.id}" data-help-page="${p.id}" style="margin-bottom:16px; display:none">\n` +
    `      <div style="font-size:26px">${esc(p.emoji)}</div>\n` +
    `      <h2 class="h3" style="margin-top:8px; font-size:22px">${esc(p.title)}</h2>\n` +
    `      <p style="color:#c4b5fd; font-size:13px; margin-top:6px">${esc(p.pitch)}</p>\n` +
    `      <h3 style="font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#6b7280; margin:14px 0 8px">Pas à pas</h3>\n` +
    `      <ol style="list-style:none; margin:0; padding:0; color:#e5e7eb; font-size:13px; line-height:1.7">\n${steps}\n      </ol>\n` +
    `      <div style="margin-top:12px; border:1px solid rgba(245,158,11,.3); background:rgba(245,158,11,.05); border-radius:12px; padding:12px 14px">\n` +
    `        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#fbbf24; margin-bottom:6px">Astuces régie</div>\n` +
    `        <ul style="list-style:none; margin:0; padding:0; color:#d1d5db; font-size:13px; line-height:1.7">\n${tips}\n        </ul>\n` +
    `      </div>\n` +
    `      <div style="margin-top:12px; border:1px solid rgba(34,211,238,.3); background:rgba(34,211,238,.05); border-radius:12px; padding:12px 14px">\n` +
    `        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#67e8f9; margin-bottom:4px">🎯 Défi</div>\n` +
    `        <p style="color:#e5e7eb; font-size:13px; margin:0">${esc(p.challenge)}</p>\n` +
    `      </div>\n` +
    `    </article>`
  );
}).join('\n');

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Aide — Light Maestro | 19 fiches par fonction</title>
<meta name="description" content="Centre d'aide Light Maestro : 19 fiches par fonction — pas-à-pas, astuces régie et défis pour chaque outil du logiciel."/>
<link rel="icon" type="image/png" href="./assets/favicon-32.png"/>
<link rel="stylesheet" href="./assets/site.css"/>
<style>.chapter{scroll-margin-top:84px} [data-help-nav].active{background:rgba(139,92,246,.18) !important; border-color:rgba(139,92,246,.35) !important; color:#ede9fe !important}</style>
</head>
<body>
<header class="nav">
  <div class="nav-inner">
    <a class="brand" href="./index.html"><img src="./assets/logo.svg" alt="Light Maestro" style="width:34px;height:34px;border-radius:10px;box-shadow:0 8px 24px rgba(168,85,247,.35)"/><span class="brand-word">LIGHT <span>MAESTRO</span></span></a>
    <nav class="nav-links"><a href="./index.html">Accueil</a><a href="./fonctionnalites.html">Fonctionnalités</a><a href="./tutoriels.html">Tutoriels</a><a class="active" href="./aide.html">Aide</a><a href="./tarifs.html">Tarifs</a><a href="./telecharger.html">Télécharger</a><a href="./support.html">Support</a></nav>
    <div style="display:flex; gap:10px; align-items:center"><a class="nav-cta" href="./telecharger.html">⬇ Télécharger</a><button class="hamburger" data-menu>≡</button></div>
  </div>
  <div data-menu-panel style="display:none; border-top:1px solid #1f1f2e; background: rgba(6,6,10,.88)"><div class="wrap" style="padding:12px 20px; display:flex; flex-wrap:wrap; gap:10px"><a href="./fonctionnalites.html">Fonctionnalités</a><a href="./tutoriels.html">Tutoriels</a><a href="./aide.html">Aide</a><a href="./tarifs.html">Tarifs</a><a href="./telecharger.html">Télécharger</a><a href="./support.html">Support</a></div></div>
</header>

<section class="hero" style="padding:28px 0 18px">
  <div class="wrap">
    <span class="kicker">Centre d'aide • 19 fiches</span>
    <h1 class="h1">Chaque fonction, expliquée comme en régie.</h1>
    <p class="lead">Pas-à-pas concrets, astuces terrain et un défi par fiche. Même contenu que l'aide intégrée au logiciel (bouton Aide en haut à droite).</p>
  </div>
</section>

<section class="section">
  <div class="wrap" style="display:grid; grid-template-columns:250px 1fr; gap:18px; align-items:start">
    <div class="card" style="position:sticky; top:84px; max-height:70vh; overflow-y:auto">
${navGroups}
    </div>
    <div>
${sections}
      <div class="card" style="text-align:center">
        <h3 class="h3">Une question qui n'est pas dans les fiches ?</h3>
        <p style="margin-top:8px">Écrivez-nous avec ce que vous vouliez faire — on répond et on enrichit l'aide.</p>
        <div style="margin-top:12px"><a class="btn btn-ghost" href="./support.html#contact">Contacter le support →</a></div>
      </div>
    </div>
  </div>
</section>

<footer class="footer">
  <div class="wrap">
    <div class="footer-grid">
      <div><div style="display:flex; align-items:center; gap:10px; font-weight:900; letter-spacing:.18em; font-size:12px"><img src="./assets/logo.svg" alt="Light Maestro" style="width:28px;height:28px;border-radius:8px"/> LIGHT MAESTRO</div><p style="margin:10px 0 0; max-width:360px">L'aide du logiciel, en ligne.</p><p class="mono" style="margin-top:10px; font-size:11px; color:#6b7280">© <span data-year></span> Light Maestro</p></div>
      <div><div style="font-weight:800; color:white; margin-bottom:8px">Apprendre</div><div style="display:grid; gap:8px"><a href="./tutoriels.html">Tutoriels</a><a href="./support.html">Support & FAQ</a></div></div>
      <div><div style="font-weight:800; color:white; margin-bottom:8px">Site</div><div style="display:grid; gap:8px"><a href="./index.html">Accueil</a><a href="./tarifs.html">Tarifs</a><a href="./telecharger.html">Télécharger</a></div></div>
      <div><div style="font-weight:800; color:white; margin-bottom:8px">Légal</div><div style="display:grid; gap:8px"><a href="./mentions-legales.html">Mentions légales</a><a href="./licence.html">Licence</a></div></div>
    </div>
  </div>
</footer>
<script src="./assets/site.js"></script>
<script>
(function(){
  var pages = Array.prototype.slice.call(document.querySelectorAll('[data-help-page]'));
  var btns = Array.prototype.slice.call(document.querySelectorAll('[data-help-nav]'));
  function show(id){
    pages.forEach(function(a){ a.style.display = a.getAttribute('data-help-page') === id ? 'block' : 'none'; });
    btns.forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-help-nav') === id); });
    var el = document.querySelector('[data-help-page="' + id + '"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { history.replaceState(null, '', '#' + id); } catch(e) {}
  }
  btns.forEach(function(b){ b.addEventListener('click', function(){ show(b.getAttribute('data-help-nav')); }); });
  var start = (location.hash || '').replace('#', '');
  show(document.querySelector('[data-help-page="' + start + '"]') ? start : pages[0].getAttribute('data-help-page'));
})();
</script>
</body>
</html>
`;

fs.writeFileSync(DEST, html);
console.log('OK', DEST, `(${(fs.statSync(DEST).size / 1024).toFixed(0)} Ko)`);
