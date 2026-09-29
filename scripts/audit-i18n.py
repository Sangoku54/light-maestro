import re
import glob

en_pat = re.compile(r'\b(Select|Browse|Loading|Click|Drag|Double-click|Save|Cancel|Delete|Create|Search|Play|Stop|Failed|Missing|Found|Available|Pick|Choose|Import|Export|Clear|Reset|Apply|Close|Show|Hide|None|All|Custom|Default|Untitled)\b')
files = glob.glob('src/**/*.tsx', recursive=True)
out = []
for f in files:
    lines = open(f, encoding='utf-8').read().split('\n')
    for i, l in enumerate(lines, 1):
        s = l.strip()
        if len(s) <= 2 or "t('" in s or 't("' in s:
            continue
        if s.startswith('//') or s.startswith('*') or s.startswith('/*'):
            continue
        if re.search(r'console\.(log|debug|warn|error)', s):
            continue
        found = False
        # JSX text
        for m in re.finditer(r'>([^<>{}]+)<', s):
            if en_pat.search(m.group(1)):
                found = True
        # attributes with English
        for m in re.finditer(r'(title|placeholder|aria-label)="([^"]+)"', s):
            if en_pat.search(m.group(2)):
                found = True
        if found:
            out.append(f'{f}:{i}: {s[:150]}')
with open('C:/Users/vitte/AppData/Local/Temp/opencode/i18n-en.txt', 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(out))
print(len(out), 'lignes')
