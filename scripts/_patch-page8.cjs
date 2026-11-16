const fs = require('fs');
const p = 'electron/remote/_page.tmp.html';
let s = fs.readFileSync(p, 'utf8');

// 5) Ajouter l appel renderCueLists() dans render()
const oldRender = `    var scenes = state.scenes || [];
    document.getElementById('scenes').innerHTML = scenes.length
      ? scenes.map(sceneCard).join('')
      : '<div class="empty">Aucune scène</div>';
    var chasers = state.chasers || [];
    document.getElementById('chasers').innerHTML = chasers.length
      ? chasers.map(chaserCard).join('')
      : '<div class="empty">Aucun chaser</div>';
    renderConsole();`;
const newRender = `    var scenes = state.scenes || [];
    document.getElementById('scenes').innerHTML = scenes.length
      ? scenes.map(sceneCard).join('')
      : '<div class="empty">Aucune scène</div>';
    var chasers = state.chasers || [];
    document.getElementById('chasers').innerHTML = chasers.length
      ? chasers.map(chaserCard).join('')
      : '<div class="empty">Aucun chaser</div>';
    var cueLists = state.cueLists || [];
    document.getElementById('cueLists').innerHTML = cueLists.length
      ? cueLists.map(cueListCard).join('')
      : '<div class="empty">Aucune Cue List</div>';
    renderConsole();`;
if (!s.includes(oldRender)) throw new Error('render introuvable');
s = s.replace(oldRender, newRender);

fs.writeFileSync(p, s, 'utf8');
console.log('patch 3 OK, taille=' + s.length);
