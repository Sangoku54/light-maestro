const fs = require("fs");
const p = "electron/remote/_page.tmp.html";
let s = fs.readFileSync(p, "utf8");

// Trouver renderChasers et ajouter renderCueLists apres
const oldRenderChasers = `  function renderChasers() {
    var chasers = state.chasers || [];
    var sig = chasers.map(function (x) { return x.id + '|' + (x.active ? 1 : 0); }).join(';');
    if (sig === chasersSig) return;
    chasersSig = sig;
    document.getElementById('chasers').innerHTML = chasers.length
      ? chasers.map(chaserCard).join('')
      : '<div class="empty">Aucun chaser</div>';
  }

  function render() {`;

const newRenderChasers = `  function renderChasers() {
    var chasers = state.chasers || [];
    var sig = chasers.map(function (x) { return x.id + '|' + (x.active ? 1 : 0); }).join(';');
    if (sig === chasersSig) return;
    chasersSig = sig;
    document.getElementById('chasers').innerHTML = chasers.length
      ? chasers.map(chaserCard).join('')
      : '<div class="empty">Aucun chaser</div>';
  }

  function renderCueLists() {
    var cueLists = state.cueLists || [];
    var sig = cueLists.map(function (x) { return x.id + '|' + (x.active ? 1 : 0); }).join(';');
    if (sig === cueListsSig) return;
    cueListsSig = sig;
    document.getElementById('cueLists').innerHTML = cueLists.length
      ? cueLists.map(cueListCard).join('')
      : '<div class="empty">Aucune Cue List</div>';
  }

  var cueListsSig = null;

  function render() {`;

if (!s.includes(oldRenderChasers)) throw new Error("renderChasers introuvable");
s = s.replace(oldRenderChasers, newRenderChasers);

fs.writeFileSync(p, s, "utf8");
console.log("patch OK, taille=" + s.length);