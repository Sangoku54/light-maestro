import re
import glob
import os

en_pages = {os.path.splitext(os.path.basename(p))[0] for p in glob.glob('site/*-en.html')}
# ex. {'index-en', ...} -> cibles FR correspondantes sans suffixe
fr_of = {name[:-3]: name for name in en_pages}  # 'index' -> 'index-en'

count = 0
for path in glob.glob('site/*-en.html'):
    t = open(path, encoding='utf-8').read()

    def repl(m):
        full, name, anchor = m.group(0), m.group(1), m.group(2)
        if name in fr_of and not name.endswith('-en'):
            return f'./{fr_of[name]}.html{anchor}'
        return full

    t2 = re.sub(r'\./([a-z-]+)\.html(#[a-z-]*)?', repl, t)
    if t2 != t:
        open(path, 'w', encoding='utf-8', newline='').write(t2)
        count += 1
print(f'{count} pages EN normalisées')
