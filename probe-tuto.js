const fs = require('fs');
const buf = fs.readFileSync('LM/tuto.lmproj');
const str = buf.toString('utf8', 8);
const start = str.indexOf('{');
let depth = 0;
let end = start;
for (let i = start; i < str.length; i++) {
  if (str[i] === '{') depth++;
  if (str[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const full = JSON.parse(str.substring(start, end));
// Check structure
console.log('Top keys:', Object.keys(full));
console.log('showStore keys:', Object.keys(full.showStore || {}));
const ss = full.showStore || {};
console.log('stageScene:', ss.stageScene);
console.log('channelData keys:', Object.keys(ss.dmx?.channelData || {}));
// Check fixturePositions
const fp = ss.fixturePositions || {};
console.log('fixturePositions count:', Object.keys(fp).length);
Object.entries(fp).forEach(([id, pos]) => {
  console.log('  ' + id + ': x=' + pos.x.toFixed(2) + ' y=' + pos.y.toFixed(2) + ' h=' + pos.h);
});
