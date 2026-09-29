import json
import collections
import subprocess

d = json.load(open('src/i18n/fr.json', encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
open('C:/Users/vitte/AppData/Local/Temp/opencode/fr-test.json', 'w', encoding='utf-8').write(
    json.dumps(d, ensure_ascii=False, indent=2) + '\n')
r = subprocess.run(['git', 'diff', '--no-index', '--stat', 'src/i18n/fr.json',
                    'C:/Users/vitte/AppData/Local/Temp/opencode/fr-test.json'],
                   capture_output=True, text=True, cwd='.')
print(r.stdout[-500:])
