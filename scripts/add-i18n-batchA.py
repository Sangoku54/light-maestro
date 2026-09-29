"""Ajoute loops.engine.* (mots, couleurs, mouvements, matrice) FR+EN."""
import json
import collections
import re

themes_src = open('src/engine/autoloop-themes.ts', encoding='utf-8').read()

# Couleurs : (hex, label FR) depuis THEME_COLORS
colors = re.findall(r"\{\s*label:\s*'((?:[^'\\]|\\.)*)',\s*hex:\s*'([^']+)'\s*\}", themes_src)
# Mouvements : (pattern, label FR)
moves = re.findall(r"\{\s*pattern:\s*'([^']+)',\s*label:\s*'((?:[^'\\]|\\.)*)'\s*\}", themes_src)
# Recettes matrice : labels FR
recipes = re.findall(r"label:\s*'((?:[^'\\]|\\.)*)',\s*start:", themes_src)
print(f'couleurs={len(colors)} mouvements={len(moves)} recettes={len(recipes)}')

COLORS_EN = {
    '#ff0000': 'Red', '#00ff00': 'Green', '#0000ff': 'Blue', '#ffffff': 'White',
    '#ffff00': 'Yellow', '#00ffff': 'Cyan', '#ff00ff': 'Magenta', '#ff8000': 'Orange',
    '#8000ff': 'Violet', '#ff4080': 'Pink', '#80ff00': 'Lime', '#00ffc8': 'Turquoise',
    '#ffc000': 'Gold', '#4000ff': 'Indigo', '#ff6f61': 'Coral', '#ffa07a': 'Salmon',
    '#bfff00': 'Chartreuse', '#00bfff': 'Azure', '#b57edc': 'Lavender', '#8b0036': 'Burgundy',
    '#808000': 'Olive', '#3eb489': 'Mint', '#ffcba4': 'Peach', '#50c878': 'Emerald',
    '#008080': 'Teal', '#dda0dd': 'Plum', '#fff5e1': 'Cream', '#c0c0c0': 'Silver',
    '#ff1493': 'Neon pink', '#39ff14': 'Neon green', '#00e5ff': 'Neon blue', '#ffbf00': 'Amber',
}
MOVES_EN = {
    'circle': 'Circle', 'square': 'Square', 'figure8': 'Figure eight', 'zigzag': 'Zigzag',
    'sweep': 'Sweep', 'wave': 'Wave', 'bounce': 'Bounce', 'pulse': 'Pulse',
    'static': 'Drift', 'spiral': 'Spiral', 'heartbeat': 'Heartbeat', 'randomWalk': 'Random walk',
    'panOnly': 'Pan only', 'tiltOnly': 'Tilt only', 'diamond': 'Diamond', 'intro': 'Intro',
    'verse': 'Verse', 'chorus': 'Chorus', 'bridge': 'Bridge', 'drop': 'Drop', 'outro': 'Outro',
}
MATRIX_EN = {
    'Chase bleu': 'Blue chase', 'Chase blanc': 'White chase', 'Chase rouge': 'Red chase',
    'Chase vert': 'Green chase', 'Chase violet': 'Violet chase', 'Chase arc-en-ciel': 'Rainbow chase',
    'Vague bleue': 'Blue wave', 'Vague verte': 'Green wave', 'Vague ambre': 'Amber wave',
    'Vague magenta': 'Magenta wave', 'Vague blanche': 'White wave', 'Vague cyan': 'Cyan wave',
    'Explosion blanche': 'White burst', 'Explosion rouge': 'Red burst', 'Explosion verte': 'Green burst',
    'Explosion dorée': 'Golden burst', 'Explosion violette': 'Violet burst',
    'Dégradé chaud': 'Warm gradient', 'Dégradé froid': 'Cold gradient',
    'Dégradé nuit': 'Night gradient', 'Dégradé blanc→rose': 'White-to-pink gradient',
    'Arc-en-ciel': 'Rainbow', 'Arc-en-ciel rapide': 'Fast rainbow', 'Arc-en-ciel lent': 'Slow rainbow',
    'Éclats aléatoires': 'Random bursts', 'Éclats rapide': 'Fast bursts',
    'Pouls blanc': 'White pulse', 'Pouls bleu': 'Blue pulse', 'Pouls rouge': 'Red pulse',
    'Strobe blanc': 'White strobe', 'Strobe cyan': 'Cyan strobe', 'Aplat blanc': 'White flat',
}
WORDS_FR = {
    'chase': 'Chase', 'colorChase': 'Color chase', 'movement': 'Movement',
    'dimmerPulse': 'Dimmer pulse', 'strobe': 'Strobe', 'colorWheel': 'Color wheel',
    'gobo': 'Gobo', 'effect': 'Effect', 'prism': 'Prism',
    'laserPatterns': 'Motifs laser', 'laserScan': 'Balayage laser', 'laserScan8': 'Balayage laser ∞',
    'laserColor': 'Couleur laser', 'autoPrefix': 'Auto',
    'tmplStrobeSlow': 'Strobe lent', 'tmplStrobeFast': 'Strobe rapide',
    'tmplBreathSlow': 'Respiration lente', 'tmplBreathFast': 'Respiration rapide',
    'tmplWheel': 'Roue couleur', 'tmplWheelGrad': 'Roue → dégradé',
    'tmplGobo': 'Gobo', 'tmplGoboFast': 'Gobo rapide', 'tmplPrism': 'Prisme',
    'tmplBeamZoom': 'Zoom large/étroit', 'tmplBeamIris': 'Iris ouvre/ferme',
    'tmplBeamFrost': 'Frost doux/plein', 'tmplBeamFocus': 'Focus proche/lointain',
    'tmplLaserScan': 'Laser — balayage', 'tmplLaserPattern': 'Laser — motif',
    'tmplMoveRadiusColor': '{move} {radius} · {color}',
    'tmplBreathPeriod': 'Respiration {period}b · {color}',
    'tmplMixSuffixStrobe': ' · Strobe', 'tmplMixSuffixBreath': ' · Respiration',
    'tmplMixSuffixStrobeFast': ' · Strobe rapide', 'tmplMixSuffixWheel': ' · Roue',
    'tmplNoChannel': 'Aucun canal',
}
WORDS_EN = {
    'chase': 'Chase', 'colorChase': 'Color chase', 'movement': 'Movement',
    'dimmerPulse': 'Dimmer pulse', 'strobe': 'Strobe', 'colorWheel': 'Color wheel',
    'gobo': 'Gobo', 'effect': 'Effect', 'prism': 'Prism',
    'laserPatterns': 'Laser patterns', 'laserScan': 'Laser sweep', 'laserScan8': 'Laser sweep ∞',
    'laserColor': 'Laser color', 'autoPrefix': 'Auto',
    'tmplStrobeSlow': 'Slow strobe', 'tmplStrobeFast': 'Fast strobe',
    'tmplBreathSlow': 'Slow breathing', 'tmplBreathFast': 'Fast breathing',
    'tmplWheel': 'Color wheel', 'tmplWheelGrad': 'Wheel → gradient',
    'tmplGobo': 'Gobo', 'tmplGoboFast': 'Fast gobo', 'tmplPrism': 'Prism',
    'tmplBeamZoom': 'Wide/narrow zoom', 'tmplBeamIris': 'Iris open/close',
    'tmplBeamFrost': 'Soft/full frost', 'tmplBeamFocus': 'Near/far focus',
    'tmplLaserScan': 'Laser — sweep', 'tmplLaserPattern': 'Laser — pattern',
    'tmplMoveRadiusColor': '{move} {radius} · {color}',
    'tmplBreathPeriod': '{period}b breathing · {color}',
    'tmplMixSuffixStrobe': ' · Strobe', 'tmplMixSuffixBreath': ' · Breathing',
    'tmplMixSuffixStrobeFast': ' · Fast strobe', 'tmplMixSuffixWheel': ' · Wheel',
    'tmplNoChannel': 'No channel',
}

missing_colors = [h for _, h in colors if h.lower() not in COLORS_EN]
missing_moves = [p for p, _ in moves if p not in MOVES_EN]
missing_mx = [r for r in recipes if r not in MATRIX_EN]
assert not missing_colors, missing_colors
assert not missing_moves, missing_moves
assert not missing_mx, missing_mx

for path, words, col_en, mov_en, mx_en, is_en in (
    ('src/i18n/fr.json', WORDS_FR, None, None, None, False),
    ('src/i18n/en.json', WORDS_EN, COLORS_EN, MOVES_EN, MATRIX_EN, True),
):
    d = json.load(open(path, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
    eng = d['loops'].get('engine')
    if eng is None:
        eng = collections.OrderedDict()
        d['loops']['engine'] = eng
    if 'words' not in eng:
        eng['words'] = collections.OrderedDict()
    for k, v in words.items():
        if k not in eng['words']:
            eng['words'][k] = v
    if 'colors' not in eng:
        eng['colors'] = collections.OrderedDict()
    for label, hx in colors:
        if hx.lower() not in eng['colors']:
            eng['colors'][hx.lower()] = col_en[hx.lower()] if is_en else label
    if 'movements' not in eng:
        eng['movements'] = collections.OrderedDict()
    for p, label in moves:
        if p not in eng['movements']:
            eng['movements'][p] = mov_en[p] if is_en else label
    if 'matrix' not in eng:
        eng['matrix'] = collections.OrderedDict()
    for r in recipes:
        if r not in eng['matrix']:
            eng['matrix'][r] = mx_en[r] if is_en else r
    open(path, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
print('OK')
