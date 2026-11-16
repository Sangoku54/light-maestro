const fs = require('fs');
const path = require('path');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})('.');

const patterns = [
  /tier\s*[:=]\s*['"][a-z]+['"]/,
  /\.tier\b/,
  /tierGroup/,
  /tierToCategory/,
];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    for (const re of patterns) {
      if (re.test(l)) {
        console.log(f + ':' + (i + 1) + '| ' + l.trim());
        break;
      }
    }
  });
}