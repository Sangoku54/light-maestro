"""Ajoute showManager.item* (modale d'édition du bloc)."""
import json
import collections

ADD_FR = {
    'editItem': "Modifier l'élément",
    'itemName': 'Nom',
    'itemFadeIn': 'Fade In (ms)',
    'itemFadeOut': 'Fade Out (ms)',
    'itemStart': 'Début (s)',
    'itemDuration': 'Durée (s)',
    'itemResource': 'Ressource',
}
ADD_EN = {
    'editItem': 'Edit item',
    'itemName': 'Name',
    'itemFadeIn': 'Fade In (ms)',
    'itemFadeOut': 'Fade Out (ms)',
    'itemStart': 'Start (s)',
    'itemDuration': 'Duration (s)',
    'itemResource': 'Resource',
}

for path, add in (('src/i18n/fr.json', ADD_FR), ('src/i18n/en.json', ADD_EN)):
    d = json.load(open(path, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
    for k, v in add.items():
        if k not in d['showManager']:
            d['showManager'][k] = v
    open(path, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
print('OK')
