"""Ajoute design.selectOrCreateMatrix."""
import json
import collections

for path, v in (('src/i18n/fr.json', 'Sélectionnez ou créez une matrice'),
                ('src/i18n/en.json', 'Select or create a matrix')):
    d = json.load(open(path, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
    if 'selectOrCreateMatrix' not in d['design']:
        d['design']['selectOrCreateMatrix'] = v
    open(path, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
print('OK')
