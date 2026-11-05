with open('src/views/Stage3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('stage3D.rigsHint')
context = content[idx-200:idx+100]

for i in range(len(context)-1):
    if context[i:i+2] == ')}':
        print('Found )} at pos ' + str(i) + ': ' + repr(context[max(0,i-20):i+20]))