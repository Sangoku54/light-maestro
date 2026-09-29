"""Fusionne les JSON i18n des sous-agents dans fr/en.json. Vérifie parité FR/EN."""
import json
import collections

BASE = 'C:/Users/vitte/AppData/Local/Temp/opencode/'
FILES = ['i18n-quickshow.json', 'i18n-timeline.json', 'i18n-stage3d.json']

fr = json.load(open('src/i18n/fr.json', encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
en = json.load(open('src/i18n/en.json', encoding='utf-8'), object_pairs_hook=collections.OrderedDict)

stats = {}
for fn in FILES:
    d = json.load(open(BASE + fn, encoding='utf-8'))
    for sec, keys in d.get('fr', {}).items():
        if sec not in fr:
            fr[sec] = collections.OrderedDict()
        n = 0
        for k, v in keys.items():
            if k not in fr[sec]:
                fr[sec][k] = v
                n += 1
            elif fr[sec][k] != v:
                print(f'CONFLIT fr.{sec}.{k} (gardé existant)')
        stats[f'{fn}:{sec}'] = n
    for sec, keys in d.get('en', {}).items():
        if sec not in en:
            en[sec] = collections.OrderedDict()
        n = 0
        for k, v in keys.items():
            if k not in en[sec]:
                en[sec][k] = v
                n += 1
            elif en[sec][k] != v:
                print(f'CONFLIT en.{sec}.{k} (gardé existant)')
        stats[f'{fn}:{sec}:en'] = n

# Parité : toute clé FR doit exister en EN et vice-versa (récursif)
def walk(fr_o, en_o, path=''):
    missing = []
    if isinstance(fr_o, dict) and isinstance(en_o, dict):
        for k in fr_o:
            if k not in en_o:
                missing.append(f'{path}.{k} manque en EN')
            else:
                missing += walk(fr_o[k], en_o[k], f'{path}.{k}')
        for k in en_o:
            if k not in fr_o:
                missing.append(f'{path}.{k} manque en FR')
    return missing

issues = walk(fr, en)
open('src/i18n/fr.json', 'w', encoding='utf-8').write(json.dumps(fr, ensure_ascii=False, indent=2) + '\n')
open('src/i18n/en.json', 'w', encoding='utf-8').write(json.dumps(en, ensure_ascii=False, indent=2) + '\n')
print(stats)
print('PARITÉ:', 'OK' if not issues else issues[:20])
