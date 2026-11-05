const fs = require('fs');
const f = process.argv[2];
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
console.log('name:', j.name, '| cat:', (j.categories || []).join(','));
for (const [k, v] of Object.entries(j.availableChannels || {})) {
  const caps = (v.capabilities || []).map(c => c.type + '(' + c.dmxRange[0] + '-' + c.dmxRange[1] + ')').join(' | ');
  console.log('[' + k + ']', caps);
}
console.log('---modes---');
for (const m of (j.modes || [])) {
  console.log('mode:', m.name, '| ch:', (m.channels || []).join(', '));
}
