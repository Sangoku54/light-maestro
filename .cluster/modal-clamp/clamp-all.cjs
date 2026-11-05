// Patch complet popovers Light Maestro — clamp viewport partout. CRLF-safe, node.
const fs = require('fs');

function patchFile(f, transforms) {
  let s = fs.readFileSync(f, 'utf8');
  let n = 0;
  for (const [oldT, newT, label] of transforms) {
    if (oldT instanceof RegExp) {
      if (!oldT.test(s)) { console.error(f, ': introuvable (regex)', label); process.exit(1); }
      s = s.replace(oldT, newT);
    } else {
      if (!s.includes(oldT)) { console.error(f, ': introuvable', label); process.exit(1); }
      s = s.split(oldT).join(newT);
    }
    n++;
  }
  fs.writeFileSync(f, s, 'utf8');
  console.log(f, 'OK', n, 'edits');
}

const C = (x, y, w, h) => `...clampRect(${x}, ${y}, ${w}, ${h}, window.innerWidth, window.innerHeight)`;
const DRAGX = (expr) => `Math.max(0, Math.min(${expr}, window.innerWidth - 120))`;
const DRAGY = (expr) => `Math.max(0, Math.min(${expr}, window.innerHeight - 40))`;

const dragTransforms = [
  ['x: float3DDragRef.current.startLeft + ev.clientX - float3DDragRef.current.startX', 'x: ' + DRAGX('float3DDragRef.current.startLeft + ev.clientX - float3DDragRef.current.startX'), 'drag x'],
  ['y: float3DDragRef.current.startTop + ev.clientY - float3DDragRef.current.startY', 'y: ' + DRAGY('float3DDragRef.current.startTop + ev.clientY - float3DDragRef.current.startY'), 'drag y'],
];

// ─────────── QuickShowView.tsx ───────────
patchFile('src/views/QuickShowView.tsx', [
  ['style={{ left: strobeEntryMenu.x, top: strobeEntryMenu.y }}', 'style={{ ' + C('strobeEntryMenu.x', 'strobeEntryMenu.y', 200, 240) + ' }}', 'strobeEntryMenu'],
  ['style={{ left: dimmerInsertMenu.x, top: dimmerInsertMenu.y }}', 'style={{ ' + C('dimmerInsertMenu.x', 'dimmerInsertMenu.y', 220, 240) + ' }}', 'dimmerInsertMenu'],
  ['style={{ left: dimmerEntryMenu.x, top: dimmerEntryMenu.y }}', 'style={{ ' + C('dimmerEntryMenu.x', 'dimmerEntryMenu.y', 200, 240) + ' }}', 'dimmerEntryMenu'],
  ['style={{ left: chaserInsertMenu.x, top: chaserInsertMenu.y }}', 'style={{ ' + C('chaserInsertMenu.x', 'chaserInsertMenu.y', 240, 340) + ' }}', 'chaserInsertMenu'],
  ['style={{ left: chaserEntryMenu.x, top: chaserEntryMenu.y }}', 'style={{ ' + C('chaserEntryMenu.x', 'chaserEntryMenu.y', 200, 240) + ' }}', 'chaserEntryMenu'],
  ['colorContextMenu.x, colorContextMenu.y, 380, 260', 'colorContextMenu.x, colorContextMenu.y, 380, 300', 'colorContextMenu h300'],
  ['scmPos.x, scmPos.y, 220, 240', 'scmPos.x, scmPos.y, 220, 280', 'scmPos h280'],
  ['\n          ref={(el) => { if (el) { const rect = el.getBoundingClientRect(); if (rect.bottom > window.innerHeight) el.style.top = \'auto\'; } }}', '', 'picker hack'],
  ...dragTransforms,
]);

// ─────────── TrackTimeline.tsx ───────────
patchFile('src/views/TrackTimeline.tsx', [
  ["import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';", "import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';\nimport { clampRect } from '../components/clampedpopup';", 'import'],
  ['style={{ left: ftMenu.x, top: ftMenu.y }}', 'style={{ ' + C('ftMenu.x', 'ftMenu.y', 220, 240) + ' }}', 'ftMenu'],
  ['style={{ left: blockMenu.x, top: blockMenu.y }}', 'style={{ ' + C('blockMenu.x', 'blockMenu.y', 200, 160) + ' }}', 'blockMenu'],
]);

// ─────────── PerformanceView.tsx ───────────
patchFile('src/views/PerformanceView.tsx', [
  ["import React, { useState, useRef, useCallback, useEffect } from 'react';", "import React, { useState, useRef, useCallback, useEffect } from 'react';\nimport { clampRect } from '../components/clampedpopup';", 'import'],
  ['style={{ left: Math.min(x, window.innerWidth - 160), top: Math.min(y, window.innerHeight - 180) }}', 'style={{ ' + C('x', 'y', 180, 220) + ' }}', 'ContextMenuPopup'],
  ...dragTransforms,
]);

// ─────────── ShowManager.tsx ───────────
patchFile('src/views/ShowManager.tsx', [
  ["import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';", "import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';\nimport { clampRect } from '../components/clampedpopup';", 'import'],
  ['style={{ left: Math.min(contextMenu.x, window.innerWidth - 180), top: Math.min(contextMenu.y, window.innerHeight - 180) }}', 'style={{ ' + C('contextMenu.x', 'contextMenu.y', 180, 180) + ' }}', 'contextMenu'],
  [/left: Math\.min\(addItemBtnRect\.left, window\.innerWidth - 200\),\r?\n\s*top: Math\.min\(addItemBtnRect\.bottom \+ 4, window\.innerHeight - 320\),/, '...clampRect(addItemBtnRect.left, addItemBtnRect.bottom + 4, 200, 340, window.innerWidth, window.innerHeight),', 'addItem style'],
]);

// ─────────── DesignView.tsx ───────────
patchFile('src/views/DesignView.tsx', [
  [/\/\/ Clamp so the menu never opens off-screen[^\r\n]*\r?\n\s*x: Math\.min\(e\.clientX, window\.innerWidth - 210\),\r?\n\s*y: Math\.min\(e\.clientY, window\.innerHeight - 280\),/, '        x: e.clientX,\n        y: e.clientY,', 'ctxMenu set brut'],
  ...dragTransforms,
]);

// ─────────── useAudioFileLoader.tsx ───────────
patchFile('src/hooks/useAudioFileLoader.tsx', [
  ['selMenu.x, selMenu.y, 220, 260', 'selMenu.x, selMenu.y, 220, 300', 'selMenu h300'],
  ['const [entitySubMenu, setEntitySubMenu] = useState', 'const [subMenuPos, setSubMenuPos] = useState({ x: 0, y: 0 });\n  const [entitySubMenu, setEntitySubMenu] = useState', 'subMenuPos state'],
  ['onMouseEnter={() => setEntitySubMenu(\'scene\')}', 'onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSubMenuPos({ x: Math.min(r.right + 4, window.innerWidth - 176), y: Math.min(r.top, window.innerHeight - 192) }); setEntitySubMenu(\'scene\'); }}', 'submenu scene'],
  ['onMouseEnter={() => setEntitySubMenu(\'chaser\')}', 'onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSubMenuPos({ x: Math.min(r.right + 4, window.innerWidth - 176), y: Math.min(r.top, window.innerHeight - 192) }); setEntitySubMenu(\'chaser\'); }}', 'submenu chaser'],
  ['onMouseEnter={() => setEntitySubMenu(\'cuelist\')}', 'onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSubMenuPos({ x: Math.min(r.right + 4, window.innerWidth - 176), y: Math.min(r.top, window.innerHeight - 192) }); setEntitySubMenu(\'cuelist\'); }}', 'submenu cuelist'],
  ['onMouseEnter={() => setEntitySubMenu(\'efx\')}', 'onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSubMenuPos({ x: Math.min(r.right + 4, window.innerWidth - 176), y: Math.min(r.top, window.innerHeight - 192) }); setEntitySubMenu(\'efx\'); }}', 'submenu efx'],
  ['className="absolute left-full top-0 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] max-h-44 overflow-y-auto"', 'className="fixed z-50 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] max-h-44 overflow-y-auto" style={{ left: subMenuPos.x, top: subMenuPos.y }}', 'submenu divs x4'],
]);

// ─────────── Stage3D.tsx ───────────
patchFile('src/views/Stage3D.tsx', [
  ["panel.style.left = (ev.clientX - ox) + 'px';", "panel.style.left = Math.max(0, Math.min(ev.clientX - ox, window.innerWidth - 120)) + 'px';", 'panel drag left'],
  ["panel.style.top = (ev.clientY - oy) + 'px';", "panel.style.top = Math.max(0, Math.min(ev.clientY - oy, window.innerHeight - 40)) + 'px';", 'panel drag top'],
]);