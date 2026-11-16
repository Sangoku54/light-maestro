const fs = require('fs');
const path = require('path');

const dir = 'site';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
const bom = Buffer.from([0xEF, 0xBB, 0xBF]);

for (const file of files) {
  const fullPath = path.join(dir, file);
  const buf = fs.readFileSync(fullPath);
  
  if (buf.length >= 3 && buf[0] === bom[0] && buf[1] === bom[1] && buf[2] === bom[2]) {
    fs.writeFileSync(fullPath, buf.slice(3));
    console.log(`Removed BOM: ${file}`);
  } else {
    console.log(`OK (no BOM): ${file}`);
  }
}

console.log('Done.');
