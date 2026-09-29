"""Ajoute license.err.* serveur + section dialogs.* ."""
import json
import collections

ERR_FR = {
    'email_taken': 'Un compte existe déjà avec cet email',
    'invalid_credentials': 'Identifiants invalides',
    'invalid_token': 'Session expirée — reconnectez-vous',
    'invalid_edition': 'Édition inconnue',
}
ERR_EN = {
    'email_taken': 'An account already exists with this email',
    'invalid_credentials': 'Invalid credentials',
    'invalid_token': 'Session expired — please sign in again',
    'invalid_edition': 'Unknown edition',
}
DLG_FR = {
    'filterShow': 'Show Light Maestro',
    'filterProject': 'Projet Light Maestro',
    'filterPreset': 'Preset Light Maestro',
    'filterAudio': 'Audio',
}
DLG_EN = {
    'filterShow': 'Light Maestro Show',
    'filterProject': 'Light Maestro Project',
    'filterPreset': 'Light Maestro Preset',
    'filterAudio': 'Audio',
}

for path, err in (('src/i18n/fr.json', ERR_FR), ('src/i18n/en.json', ERR_EN)):
    d = json.load(open(path, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
    for k, v in err.items():
        if k not in d['license']['err']:
            d['license']['err'][k] = v
    open(path, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')

for path, dlg in (('src/i18n/fr.json', DLG_FR), ('src/i18n/en.json', DLG_EN)):
    d = json.load(open(path, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
    if 'dialogs' not in d:
        d['dialogs'] = collections.OrderedDict()
    for k, v in dlg.items():
        if k not in d['dialogs']:
            d['dialogs'][k] = v
    open(path, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
print('OK')
