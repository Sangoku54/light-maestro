// Retire le BOM UTF-8 des JSON (introduit par Set-Content PowerShell 5.1)
// et vérifie leur validité.
const fs = require('fs');
for (const f of ['package.json', 'package-lock.json']) {
  let s = fs.readFileSync(f, 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  JSON.parse(s); // valide avant écriture
  fs.writeFileSync(f, s, 'utf8'); // utf8 sans BOM
  console.log(f, 'OK, version:', JSON.parse(s).version ?? '(lock)');
}