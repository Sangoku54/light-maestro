const fs = require('fs');
const path = require('path');
const dir = '.prof';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.cpuprofile'));
const agg = new Map();
let total = 0;
for (const f of files) {
  const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const byId = new Map(p.nodes.map(n => [n.id, n]));
  for (let i = 0; i < (p.samples || []).length; i++) {
    const dt = (p.timeDeltas || [])[i] || 0;
    const n = byId.get(p.samples[i]);
    if (!n) continue;
    const cf = n.callFrame;
    const fn = cf.functionName || '(anon)';
    if (fn === '(idle)' || fn === '(program)') continue;
    const url = (cf.url || '').split(/[\\/]/).pop();
    const key = `${fn} @ ${url}:${cf.lineNumber + 1}`;
    agg.set(key, (agg.get(key) || 0) + dt);
    total += dt;
  }
}
console.log(`Temps total (hors idle) : ${(total / 1000).toFixed(0)} ms`);
for (const [k, v] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`${(v / 1000).toFixed(0).padStart(6)} ms  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
}
