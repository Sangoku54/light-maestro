const fs = require('fs');
const p = 'electron/remote/_page.tmp.html';
let s = fs.readFileSync(p, 'utf8');

// 1) Ajouter l'onglet "Cue Lists" dans les tabs
const oldTabs = `  <div class="tabs">
    <button class="tab on" data-tab="scenes" type="button">Scènes</button>
    <button class="tab" data-tab="chasers" type="button">Chasers</button>
    <button class="tab" data-tab="console" type="button">Console</button>
  </div>`;
const newTabs = `  <div class="tabs">
    <button class="tab on" data-tab="scenes" type="button">Scènes</button>
    <button class="tab" data-tab="chasers" type="button">Chasers</button>
    <button class="tab" data-tab="cueLists" type="button">Cue Lists</button>
    <button class="tab" data-tab="console" type="button">Console</button>
  </div>`;
if (!s.includes(oldTabs)) throw new Error('tabs introuvable');
s = s.replace(oldTabs, newTabs);

// 2) Ajouter le panel "Cue Lists" après le panel chasers
const oldPanels = `  <div id="panel-chasers" class="hidden">
    <div class="cards" id="chasers"></div>
  </div>
  <div id="panel-console" class="hidden">`;
const newPanels = `  <div id="panel-chasers" class="hidden">
    <div class="cards" id="chasers"></div>
  </div>
  <div id="panel-cueLists" class="hidden">
    <div class="cards" id="cueLists"></div>
  </div>
  <div id="panel-console" class="hidden">`;
if (!s.includes(oldPanels)) throw new Error('panels introuvable');
s = s.replace(oldPanels, newPanels);

fs.writeFileSync(p, s, 'utf8');
console.log('patch 1 OK, taille=' + s.length);
