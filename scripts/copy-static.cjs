// Copie les fichiers runtime statiques (JS pur non émis par tsc) vers dist/.
// usb-output.js est spawné par le moteur DMX via ELECTRON_RUN_AS_NODE=1 ;
// il doit être présent dans dist/electron/dmx/ à côté de worker.js.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [
  ['electron', 'dmx', 'usb-output.js'],
];

for (const rel of files) {
  const src = path.join(root, ...rel);
  const dst = path.join(root, 'dist', ...rel);
  if (!fs.existsSync(src)) {
    console.warn('[copy-static] absent (ignoré) :', rel.join('/'));
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('[copy-static]', rel.join('/'), '->', path.relative(root, dst));
}
