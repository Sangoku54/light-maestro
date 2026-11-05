const fs = require('fs');
for (const f of ['site/index.html', 'site/index-en.html', 'site/fonctionnalites.html', 'site/fonctionnalites-en.html']) {
  const html = fs.readFileSync(f, 'utf8');
  const imgs = (html.match(/<img src="\.\/assets\//g) || []).length;
  const placeholders = (html.match(/🖼️/g) || []).length;
  console.log(f + ': ' + imgs + ' images, ' + placeholders + ' placeholders restants');
}
console.log('Vérification terminée');
