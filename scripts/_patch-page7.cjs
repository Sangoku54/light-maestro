const fs = require('fs');
const p = 'electron/remote/_page.tmp.html';
let s = fs.readFileSync(p, 'utf8');

// 3) Ajouter la fonction de rendu pour cue lists
const oldChaserCard = `  function chaserCard(c) {
    var cls = c.active ? ' on' : '';
    return '<div class="card' + cls + '" data-id="' + esc(c.id) + '">'
      + '<h3><span class="dot"></span>' + esc(c.name || c.id) + '</h3>'
      + '<div class="row">'
      + '<button class="btn nav" data-a="previous" type="button">&#9664;</button>'
      + '<button class="btn play" data-a="play" type="button">&#9654; Lire</button>'
      + '<button class="btn stop" data-a="stop" type="button">&#9632; Stop</button>'
      + '<button class="btn nav" data-a="next" type="button">&#9654;&#9654;</button>'
      + '</div></div>';
  }`;

const cueListCard = `  function cueListCard(c) {
    var cls = c.active ? ' on' : '';
    var cueInfo = c.totalCues > 0 ? (' — repère ' + (c.currentCueIndex + 1) + '/' + c.totalCues) : '';
    return '<div class="card' + cls + '" data-id="' + esc(c.id) + '">'
      + '<h3><span class="dot"></span>' + esc(c.name || c.id) + cueInfo + '</h3>'
      + '<div class="row">'
      + '<button class="btn nav" data-a="back" type="button">&#9664; Précédent</button>'
      + '<button class="btn play" data-a="go" type="button">&#9654; Suivant</button>'
      + '<button class="btn stop" data-a="stop" type="button">&#9632; Stop</button>'
      + '</div></div>';
  }

  function chaserCard(c) {`;

if (!s.includes(oldChaserCard)) throw new Error('chaserCard introuvable');
s = s.replace(oldChaserCard, cueListCard);

// 4) Ajouter le bindActions pour cueLists (après bindActions chasers)
const oldBind = `  bindActions('chasers', 'api/chaser');

  // ── Rendu de la Console Virtuelle`;
const newBind = `  bindActions('chasers', 'api/chaser');
  bindActions('cueLists', 'api/cueList');

  // ── Rendu de la Console Virtuelle`;
if (!s.includes(oldBind)) throw new Error('bindActions introuvable');
s = s.replace(oldBind, newBind);

fs.writeFileSync(p, s, 'utf8');
console.log('patch 2 OK, taille=' + s.length);