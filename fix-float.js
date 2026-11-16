const fs = require('fs');
const path = require('path');

const dir = 'site';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

const styleBlock = `<style>.dl-float{position:fixed;bottom:24px;right:24px;z-index:9999}.dl-float a{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:14px;box-shadow:0 4px 14px rgba(168,85,247,.4);transition:transform .2s,box-shadow .2s}.dl-float a:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(168,85,247,.5)}</style>`;

for (const file of files) {
  const fullPath = path.join(dir, file);
  const content = fs.readFileSync(fullPath, 'utf-8');
  
  const styleStart = content.indexOf('<style>.dl-float{');
  const bodyEnd = content.indexOf('</body>');
  
  if (styleStart === -1 || bodyEnd === -1) continue;
  
  const lang = file.endsWith('-en.html') ? 'en' : 'fr';
  const btnText = lang === 'en' ? 'Download for free' : 'Télécharger gratuitement';
  const btn = `<div class="dl-float"><a href="./telecharger${lang === 'en' ? '-en' : ''}.html">${btnText}</a></div>`;
  
  const newContent = content.slice(0, styleStart) + styleBlock + btn + content.slice(bodyEnd);
  
  fs.writeFileSync(fullPath, newContent, 'utf-8');
  console.log(`OK: ${file}`);
}