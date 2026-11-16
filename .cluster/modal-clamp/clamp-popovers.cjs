// Clamp viewport des popovers : remplace `style={{ left: X.x, top: X.y }}`
// par un clamp clampRect (jamais hors écran). CRLF-safe.
const fs = require('fs');

function patchFile(f, imports, replaces) {
  let s = fs.readFileSync(f, 'utf8');
  let n = 0;
  // 1. Import clampRect après la première ligne d'import existante
  const importAnchor = imports[0];
  if (!s.includes(importAnchor)) { console.error(f, ': ancre import introuvable'); process.exit(1); }
  if (!s.includes("from '../components/clampedpopup'") && !s.includes("from './components/clampedpopup'")) {
    s = s.replace(importAnchor, importAnchor + '\n' + imports[1]);
    n++;
  }
  // 2. Remplacements style
  for (const [oldT, newT, label] of replaces) {
    if (!s.includes(oldT)) { console.error(f, ': introuvable', label); process.exit(1); }
    s = s.split(oldT).join(newT);
    n++;
  }
  fs.writeFileSync(f, s, 'utf8');
  console.log(f, 'OK', n, 'edits');
}

const clamp = (x, y, w, h) => `...clampRect(${x}, ${y}, ${w}, ${h}, window.innerWidth, window.innerHeight)`;

// ── QuickShowView.tsx ──
patchFile(
  'src/views/QuickShowView.tsx',
  ["import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';", "import { clampRect } from '../components/clampedpopup';"],
  [
    ['style={{ left: efxContextMenu.x, top: efxContextMenu.y }}', 'style={{ ' + clamp('efxContextMenu.x', 'efxContextMenu.y', 200, 240) + ' }}', 'efxContextMenu'],
    ['style={{ left: efxEntryMenu.x, top: efxEntryMenu.y }}', 'style={{ ' + clamp('efxEntryMenu.x', 'efxEntryMenu.y', 200, 240) + ' }}', 'efxEntryMenu'],
    ['style={{ left: colorContextMenu.x, top: colorContextMenu.y }}', 'style={{ ' + clamp('colorContextMenu.x', 'colorContextMenu.y', 380, 260) + ' }}', 'colorContextMenu'],
    ['style={{ left: colorEntryMenu.x, top: colorEntryMenu.y }}', 'style={{ ' + clamp('colorEntryMenu.x', 'colorEntryMenu.y', 380, 260) + ' }}', 'colorEntryMenu'],
    ['style={{ left: scmPos.x, top: scmPos.y }}', 'style={{ ' + clamp('scmPos.x', 'scmPos.y', 220, 240) + ' }}', 'scmPos'],
    ['style={{ left: picker.x || \'auto\', top: picker.y || \'auto\' }}', 'style={{ ' + clamp('picker.x || 0', 'picker.y || 0', 220, 320) + ' }}', 'picker'],
  ],
);

// ── DesignView.tsx ──
patchFile(
  'src/views/DesignView.tsx',
  ["import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';", "import { clampRect } from '../components/clampedpopup';"],
  [
    ["style={{ left: ctxMenu.x, top: ctxMenu.y }}", 'style={{ ' + clamp('ctxMenu.x', 'ctxMenu.y', 240, 240) + ' }}', 'ctxMenu (x5)'],
    ["style={{ left: contextMenu.x, top: contextMenu.y }}", 'style={{ ' + clamp('contextMenu.x', 'contextMenu.y', 240, 240) + ' }}', 'contextMenu'],
  ],
);

// ── useAudioFileLoader.tsx ──
patchFile(
  'src/hooks/useAudioFileLoader.tsx',
  ["import React, { useRef, useState, useCallback, useEffect } from 'react';", "import { clampRect } from '../components/clampedpopup';"],
  [
    ['style={{ left: selMenu.x, top: selMenu.y }}', 'style={{ ' + clamp('selMenu.x', 'selMenu.y', 220, 260) + ' }}', 'selMenu'],
  ],
);