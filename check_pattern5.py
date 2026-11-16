with open('src/views/Stage3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('stage3D.rigsHint')
start = content.rfind('              );', 0, idx)
actual = content[idx-200:idx+100]
print('Actual:')
print(repr(actual))
print('---')

old_list = [
    '              );\n',
    '            )}\n',
    '            <p className="px-2 pt-1 text-[9px] text-gray-600">{t(\'stage3D.rigsHint\')}</p>\n',
    '          </div>\n',
    '        );\n',
    '      })()}\n'
]

old_str = ''.join(old_list)

new_list = [
    '              );\n',
    '            )}\n',
    '            <p className="px-2 pt-1 text-[9px] text-gray-600">{t(\'stage3D.rigsHint\')}</p>\n',
    '          </div>\n',
    '        );\n',
    '      })()}\n'
]

new_str = ''.join(new_list)

print('Old pattern:')
print(repr(old_str))
print('Match:', old_str in content)