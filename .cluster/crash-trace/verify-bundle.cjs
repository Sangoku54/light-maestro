const fs = require('fs');
const b = 'release/win-unpacked/resources/app/dist/renderer/assets/index-eujE679Z.js';
const s = fs.readFileSync(b, 'utf8');
const keys = '"primary","secondary","tertiary","other"';
const i = s.indexOf(keys);
console.log('TIER_KEYS (4 valeurs):', i >= 0 ? 'TROUVE @' + i : 'absent');
if (i >= 0) console.log('...' + s.slice(Math.max(0, i - 140), i + 60) + '...');
const go = s.indexOf('??=[]');
console.log('get-or-create bucket ??=[]:', go >= 0 ? 'present' : 'absent');
if (go >= 0) console.log('...' + s.slice(Math.max(0, go - 90), go + 30) + '...');
// ancien pattern crash exact (3 cles, push direct)
const oldCrash = /primary:\[\],secondary:\[\],tertiary:\[\]/.test(s);
console.log('ancien bucket 3 cles (crash):', oldCrash ? 'EN CORE PRESENT' : 'absent (bon)');