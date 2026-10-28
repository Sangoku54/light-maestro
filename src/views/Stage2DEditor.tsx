/**
 * Stage2DEditor — 2D Stage positioning editor for the Design sidebar
 *
 * Shows a top-down 2D stage view with all patched fixtures.
 * Click+drag to reposition, right-click to set height.
 * Shift+click to multi-select. Alignment tools for selected fixtures.
 * Positions are persisted in useShowStore.fixturePositions (shared with Stage3D).
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShowStore, getFixtureColor, type PatchedFixture } from '../stores/showStore';
import { deckRectMeters } from '../utils/stage-decks';
import { Eye, Maximize2, AlignStartVertical, AlignStartHorizontal, AlignLeft, AlignRight, ArrowLeftRight, ArrowUpDown } from 'lucide-react';
import { generateAllThumbnails, getVariantsForCategory } from '../utils/fixtureThumbnails';
import { Stage3D } from './Stage3D';


export const Stage2DEditor: React.FC = () => {
  const { t } = useTranslation();
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const fixturePositions = useShowStore((s) => s.fixturePositions);
  const stageDims = useShowStore((s) => s.stageDims);
  const stageDecks = useShowStore((s) => s.stageDecks);
  const setFixturePosition = useShowStore((s) => s.setFixturePosition);
  const initFixturePosition = useShowStore((s) => s.initFixturePosition);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const dragRef = useRef<{ ids: Set<string>; offsets: Map<string, { sx: number; sy: number }>; startMouse: { fx: number; fy: number } } | null>(null);
  // Thumbnails chosen at patch time (fixtureThumbnails data URLs) — loaded once
  const thumbnails = useMemo(() => {
    const map = new Map<string, HTMLImageElement>();
    for (const v of generateAllThumbnails()) {
      const img = new Image();
      img.src = v.dataUrl;
      map.set(v.id, img);
    }
    return map;
  }, []);

  // Fallback thumbnail per fixture type for fixtures patched before thumbnailId existed
  const typeThumbFallback = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of patchedFixtures) {
      if (!map.has(f.fixtureType)) {
        map.set(f.fixtureType, getVariantsForCategory(f.fixtureType)[0]?.id ?? 'par-can');
      }
    }
    return map;
  }, [patchedFixtures]);

  const [showBeams, setShowBeams] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<Set<string>>(new Set());
  const marqueeRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number; active: boolean } | null>(null);

  // Floating 3D companion view (same pill pattern as the other Design tabs)
  const [showFloating3D, setShowFloating3D] = useState(false);
  const [float3DPos, setFloat3DPos] = useState({ x: 100, y: 80 });
  const [float3DSize, setFloat3DSize] = useState({ w: 960, h: 540 });
  const float3DDragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const float3DResizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const handleFloat3DDragStart = useCallback((e: React.MouseEvent) => {
    float3DDragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: float3DPos.x, startTop: float3DPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!float3DDragRef.current) return;
      setFloat3DPos({ x: Math.max(0, Math.min(float3DDragRef.current.startLeft + ev.clientX - float3DDragRef.current.startX, window.innerWidth - 120)), y: Math.max(0, Math.min(float3DDragRef.current.startTop + ev.clientY - float3DDragRef.current.startY, window.innerHeight - 40)) });
    };
    const onUp = () => { float3DDragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [float3DPos]);
  const handleFloat3DResizeStart = useCallback((e: React.MouseEvent) => {
    float3DResizeRef.current = { startX: e.clientX, startY: e.clientY, startW: float3DSize.w, startH: float3DSize.h };
    const onMove = (ev: MouseEvent) => {
      if (!float3DResizeRef.current) return;
      setFloat3DSize({ w: Math.max(320, float3DResizeRef.current.startW + ev.clientX - float3DResizeRef.current.startX), h: Math.max(200, float3DResizeRef.current.startH + ev.clientY - float3DResizeRef.current.startY) });
    };
    const onUp = () => { float3DResizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [float3DSize]);

  // Init positions for new fixtures
  useEffect(() => {
    for (let i = 0; i < patchedFixtures.length; i++) {
      const pf = patchedFixtures[i];
      if (!fixturePositions[pf.id]) {
        initFixturePosition(pf.id, pf.fixtureType, i);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchedFixtures.map(f => f.id).join(',')]);

  // ─── Alignment helpers ───
  const alignVertical = useCallback(() => {
    if (selectedFixtureIds.size < 2) return;
    const positions = patchedFixtures
      .filter(f => selectedFixtureIds.has(f.id))
      .map(f => fixturePositions[f.id])
      .filter(Boolean);
    if (positions.length < 2) return;
    const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
    for (const f of patchedFixtures) {
      if (selectedFixtureIds.has(f.id)) setFixturePosition(f.id, { x: avgX });
    }
  }, [selectedFixtureIds, patchedFixtures, fixturePositions, setFixturePosition]);

  const alignHorizontal = useCallback(() => {
    if (selectedFixtureIds.size < 2) return;
    const positions = patchedFixtures
      .filter(f => selectedFixtureIds.has(f.id))
      .map(f => fixturePositions[f.id])
      .filter(Boolean);
    if (positions.length < 2) return;
    const avgY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
    for (const f of patchedFixtures) {
      if (selectedFixtureIds.has(f.id)) setFixturePosition(f.id, { y: avgY });
    }
  }, [selectedFixtureIds, patchedFixtures, fixturePositions, setFixturePosition]);

  const alignLeft = useCallback(() => {
    if (selectedFixtureIds.size < 2) return;
    const positions = patchedFixtures
      .filter(f => selectedFixtureIds.has(f.id))
      .map(f => fixturePositions[f.id])
      .filter(Boolean);
    if (positions.length < 2) return;
    const minX = positions.reduce((min, p) => Math.min(min, p.x), 1);
    for (const f of patchedFixtures) {
      if (selectedFixtureIds.has(f.id)) setFixturePosition(f.id, { x: minX });
    }
  }, [selectedFixtureIds, patchedFixtures, fixturePositions, setFixturePosition]);

  const alignRight = useCallback(() => {
    if (selectedFixtureIds.size < 2) return;
    const positions = patchedFixtures
      .filter(f => selectedFixtureIds.has(f.id))
      .map(f => fixturePositions[f.id])
      .filter(Boolean);
    if (positions.length < 2) return;
    const maxX = positions.reduce((max, p) => Math.max(max, p.x), 0);
    for (const f of patchedFixtures) {
      if (selectedFixtureIds.has(f.id)) setFixturePosition(f.id, { x: maxX });
    }
  }, [selectedFixtureIds, patchedFixtures, fixturePositions, setFixturePosition]);

  const distributeHorizontal = useCallback(() => {
    if (selectedFixtureIds.size < 3) return;
    const selected = patchedFixtures
      .filter(f => selectedFixtureIds.has(f.id))
      .map(f => ({ id: f.id, ...fixturePositions[f.id] }))
      .filter(p => p.x !== undefined)
      .sort((a, b) => a.x - b.x);
    if (selected.length < 3) return;
    const totalRange = selected[selected.length - 1].x - selected[0].x;
    const gap = totalRange / (selected.length - 1);
    for (let i = 0; i < selected.length; i++) {
      setFixturePosition(selected[i].id, { x: selected[0].x + i * gap });
    }
  }, [selectedFixtureIds, patchedFixtures, fixturePositions, setFixturePosition]);

  const distributeVertical = useCallback(() => {
    if (selectedFixtureIds.size < 3) return;
    const selected = patchedFixtures
      .filter(f => selectedFixtureIds.has(f.id))
      .map(f => ({ id: f.id, ...fixturePositions[f.id] }))
      .filter(p => p.y !== undefined)
      .sort((a, b) => a.y - b.y);
    if (selected.length < 3) return;
    const totalRange = selected[selected.length - 1].y - selected[0].y;
    const gap = totalRange / (selected.length - 1);
    for (let i = 0; i < selected.length; i++) {
      setFixturePosition(selected[i].id, { y: selected[0].y + i * gap });
    }
  }, [selectedFixtureIds, patchedFixtures, fixturePositions, setFixturePosition]);

  // Canvas render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    // Base aux mêmes dimensions que la vue 3D : rectangle proportionnel à stageDims (mètres), centré, même aspect que Stage3D
    const availW = Math.max(80, W - 96);
    const availH = Math.max(80, H - 96);
    const aspect = Math.max(0.2, Math.min(5, stageDims.width / Math.max(0.1, stageDims.depth)));
    let sw: number, sh: number;
    if (availW / availH > aspect) {
      sh = availH;
      sw = sh * aspect;
    } else {
      sw = availW;
      sh = sw / aspect;
    }
    const padX = (W - sw) / 2;
    const padY = (H - sh) / 2;
    const pad = 48; // gardé pour compatibilité hitTest (sera recalculé via padX/padY)

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0a0a14';
      ctx.fillRect(0, 0, W, H);

      // Grid — même repère que Stage3D (mètres)
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 0.5;
      const cols = stageDims.width;
      const rows = stageDims.depth;
      for (let i = 0; i <= cols; i++) {
        const x = padX + (i / cols) * sw;
        ctx.beginPath();
        ctx.moveTo(x, padY);
        ctx.lineTo(x, padY + sh);
        ctx.stroke();
      }
      for (let i = 0; i <= rows; i++) {
        const y = padY + (i / rows) * sh;
        ctx.beginPath();
        ctx.moveTo(padX, y);
        ctx.lineTo(padX + sw, y);
        ctx.stroke();
      }

      // Stage border — mêmes dimensions/proportions que Stage3D
      ctx.strokeStyle = '#3a3a5e';
      ctx.lineWidth = 2;
      ctx.strokeRect(padX, padY, sw, sh);

      // Decks (plateaux multi-rects, rotation plane) — remplissage + nom + hauteur
      for (const deck of stageDecks) {
        const r = deckRectMeters(deck, stageDims);
        // centre en px (même repère centré que les fixtures)
        const cxp = padX + ((r.x / stageDims.width) + 0.5) * sw;
        const cyp = padY + ((r.z / stageDims.depth) + 0.5) * sh;
        const dw = (r.w / stageDims.width) * sw;
        const dh = (r.d / stageDims.depth) * sh;
        ctx.save();
        ctx.translate(cxp, cyp);
        // Même sens qu'en 3D : horaire vu du dessus (écran : +z vers le bas).
        ctx.rotate(((deck.rot ?? 0) * Math.PI) / 180);
        ctx.fillStyle = 'rgba(168, 85, 247, 0.07)';
        ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
        ctx.strokeStyle = '#6d5aa8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-dw / 2, -dh / 2, dw, dh);
        ctx.restore();
        ctx.fillStyle = '#8b7ab8';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${deck.name} · ${deck.h}m`, cxp, cyp);
        ctx.textAlign = 'left';
      }

      // Stage label
      ctx.fillStyle = '#3a3a5e';
      ctx.font = '10px monospace';
      ctx.fillText(`${stageDims.width}m × ${stageDims.depth}m`, padX + 6, padY + 14);

      // Direction labels
      ctx.fillStyle = '#4a4a6e';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FRONT (Audience ↓)', padX + sw / 2, padY - 8);
      ctx.textAlign = 'left';
      ctx.fillText('BACK', padX + sw / 2 - 16, padY + sh + 14);

      // Fixtures
      for (let i = 0; i < patchedFixtures.length; i++) {
        const pf = patchedFixtures[i];
        const pos = fixturePositions[pf.id] || { x: 0.5, y: 0.3, h: 0.5, heading: 0 };
        const fx = padX + pos.x * sw;
        const fy = padY + pos.y * sh;
        const r = 16;
        const color = getFixtureColor(i);
        const isSelected = selectedFixtureIds.has(pf.id);

        // Beam cone
        if (showBeams) {
          const beamLen = 50;
          ctx.save();
          ctx.globalAlpha = isSelected ? 0.15 : 0.08;
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx - beamLen * 0.25, fy + beamLen);
          ctx.lineTo(fx + beamLen * 0.25, fy + beamLen);
          ctx.closePath();
          const beamGrad = ctx.createLinearGradient(fx, fy, fx, fy + beamLen);
          beamGrad.addColorStop(0, color);
          beamGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = beamGrad;
          ctx.fill();
          ctx.restore();
        }

        // Thumbnail (chosen at patch time) or fallback circle
        const thumbId = pf.thumbnailId ?? typeThumbFallback.get(pf.fixtureType);
        const thumbImg = thumbId ? thumbnails.get(thumbId) : undefined;
        const thumbReady = !!thumbImg && thumbImg.complete && thumbImg.naturalWidth > 0;
        const drawR = thumbReady ? 15 : r;

        // Selection glow ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(fx, fy, drawR + 5, 0, Math.PI * 2);
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Tier border color
        const tierBorderColor =
          pf.tier === 'primary' ? '#a855f7' :
          pf.tier === 'secondary' ? '#3b82f6' : '#6b7280';

        if (thumbReady) {
          // Fixture thumbnail picked at patch time
          ctx.drawImage(thumbImg!, fx - drawR, fy - drawR, drawR * 2, drawR * 2);
          ctx.beginPath();
          ctx.arc(fx, fy, drawR, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected ? '#a855f7' : tierBorderColor;
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.stroke();
        } else {
          // Circle
          ctx.beginPath();
          ctx.arc(fx, fy, r, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? '#2a1a4ecc' : '#1a1a2ecc';
          ctx.fill();

          // Tier border
          ctx.strokeStyle = isSelected ? '#a855f7' : tierBorderColor;
          ctx.lineWidth = isSelected ? 3 : 2.5;
          ctx.stroke();

          // Inner circle (color dot)
          ctx.beginPath();
          ctx.arc(fx, fy, r - 5, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? '#c084fc' : color;
          ctx.fill();
        }

        // Height indicator (small bar on side)
        const hBarH = Math.max(2, pos.h * 16);
        ctx.fillStyle = '#ffffff33';
        ctx.fillRect(fx + drawR + 3, fy - hBarH / 2, 3, hBarH);

        // Label
        if (showLabels) {
          const label = pf.name.length > 14 ? pf.name.slice(0, 13) + '…' : pf.name;
          ctx.fillStyle = '#9ca3af';
          ctx.font = '9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(label, fx, fy + drawR + 13);

          // Tier badge
          const tierBadge = pf.tier === 'primary' ? 'P' : pf.tier === 'secondary' ? 'S' : 'T';
          ctx.fillStyle = tierBorderColor;
          ctx.font = 'bold 8px Inter, sans-serif';
          ctx.fillText(tierBadge, fx, fy - drawR - 7);

          // Height text
          ctx.fillStyle = '#5a5a7e';
          ctx.font = '7px Inter, sans-serif';
          ctx.fillText(`${(pos.h * 5.0).toFixed(1)}m`, fx, fy - drawR - 16);

          // Heading arrow (points forward direction)
          if (pos.heading !== undefined) {
            const hRad = (pos.heading * Math.PI) / 180;
            const arrowLen = drawR + 8;
            ctx.strokeStyle = '#f59e0b80';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(fx + Math.cos(hRad - Math.PI / 2) * arrowLen, fy + Math.sin(hRad - Math.PI / 2) * arrowLen);
            ctx.stroke();
            // Arrowhead
            const tipX = fx + Math.cos(hRad - Math.PI / 2) * arrowLen;
            const tipY = fy + Math.sin(hRad - Math.PI / 2) * arrowLen;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - Math.cos(hRad - Math.PI / 2 - 0.5) * 4, tipY - Math.sin(hRad - Math.PI / 2 - 0.5) * 4);
            ctx.lineTo(tipX - Math.cos(hRad - Math.PI / 2 + 0.5) * 4, tipY - Math.sin(hRad - Math.PI / 2 + 0.5) * 4);
            ctx.closePath();
            ctx.fillStyle = '#f59e0b80';
            ctx.fill();
          }
        }
      }

      // Draw marquee selection rectangle
      if (marqueeRef.current?.active) {
        const m = marqueeRef.current;
        const minX = Math.min(m.startX, m.currentX);
        const maxX = Math.max(m.startX, m.currentX);
        const minY = Math.min(m.startY, m.currentY);
        const maxY = Math.max(m.startY, m.currentY);
        const rMinX = padX + minX * sw;
        const rMaxX = padX + maxX * sw;
        const rMinY = padY + minY * sh;
        const rMaxY = padY + maxY * sh;
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(rMinX, rMinY, rMaxX - rMinX, rMaxY - rMinY);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(168, 85, 247, 0.1)';
        ctx.fillRect(rMinX, rMinY, rMaxX - rMinX, rMaxY - rMinY);
      }

      // Empty state
      if (patchedFixtures.length === 0) {
        ctx.fillStyle = '#4b5563';
        ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No fixtures patched — add fixtures in the Fixtures tab', W / 2, H / 2);
      }

      animRef.current = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [patchedFixtures, fixturePositions, stageDims, stageDecks, selectedFixtureIds, showBeams, showLabels, thumbnails]);

  // ── Mouse handlers — même repère centré que le rendu (aspect stageDims)
  const getCanvasCoords = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { fx: 0, fy: 0 };
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const availW = Math.max(80, rect.width - 96);
    const availH = Math.max(80, rect.height - 96);
    const aspect = Math.max(0.2, Math.min(5, stageDims.width / Math.max(0.1, stageDims.depth)));
    let sw: number, sh: number;
    if (availW / availH > aspect) { sh = availH; sw = sh * aspect; } else { sw = availW; sh = sw / aspect; }
    const padX = (rect.width - sw) / 2;
    const padY = (rect.height - sh) / 2;
    return { fx: (x - padX) / sw, fy: (y - padY) / sh };
  }, [stageDims]);

  const hitTestFixture = useCallback((cx: number, cy: number): string | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const availW = Math.max(80, rect.width - 96);
    const availH = Math.max(80, rect.height - 96);
    const aspect = Math.max(0.2, Math.min(5, stageDims.width / Math.max(0.1, stageDims.depth)));
    let sw: number, sh: number;
    if (availW / availH > aspect) { sh = availH; sw = sh * aspect; } else { sw = availW; sh = sw / aspect; }
    const padX = (rect.width - sw) / 2;
    const padY = (rect.height - sh) / 2;
    for (const pf of patchedFixtures) {
      const pos = fixturePositions[pf.id] || { x: 0.5, y: 0.3, h: 0.5, heading: 0 };
      const fx = padX + pos.x * sw;
      const fy = padY + pos.y * sh;
      if (Math.hypot(cx - fx, cy - fy) < 20) return pf.id;
    }
    return null;
  }, [patchedFixtures, fixturePositions]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Right-click: cycle height preset on fixture, clear selection on empty space
    if (e.button === 2) {
      const hitId = hitTestFixture(x, y);
      if (hitId) {
        e.preventDefault();
        const pos = fixturePositions[hitId];
        if (pos) {
          const heights = [0.1, 0.3, 0.5, 0.6, 0.8, 1.0];
          const currentIdx = heights.findIndex(h => Math.abs(h - pos.h) < 0.02);
          const nextIdx = (currentIdx + 1) % heights.length;
          // Apply to all selected if this fixture is selected
          const targets = selectedFixtureIds.has(hitId) ? selectedFixtureIds : new Set([hitId]);
          for (const tid of targets) {
            setFixturePosition(tid, { h: heights[nextIdx] });
          }
        }
      } else {
        // Right-click on empty space: clear selection
        if (selectedFixtureIds.size > 0) {
          setSelectedFixtureIds(new Set());
        }
      }
      return;
    }

    // Left-click
    const shift = e.shiftKey;
    const pad = 48;
    const sw = rect.width - 96;
    const sh = rect.height - 96;

    const hitId = hitTestFixture(x, y);
    const { fx: mfx, fy: mfy } = getCanvasCoords(e);

    if (hitId) {
      let newSelection: Set<string>;
      if (shift) {
        // Shift+click: toggle selection
        newSelection = new Set(selectedFixtureIds);
        if (newSelection.has(hitId)) {
          newSelection.delete(hitId);
        } else {
          newSelection.add(hitId);
        }
      } else {
        // Click on fixture: select it (or keep multi-selection if already selected)
        if (!selectedFixtureIds.has(hitId)) {
          newSelection = new Set([hitId]);
        } else {
          newSelection = selectedFixtureIds; // keep existing multi-selection
        }
      }
      setSelectedFixtureIds(newSelection);

      // Start drag for entire selection
      const dragIds = newSelection.size > 0 ? newSelection : new Set([hitId]);
      const offsets = new Map<string, { sx: number; sy: number }>();
      for (const id of dragIds) {
        const pos = fixturePositions[id];
        if (pos) {
          offsets.set(id, { sx: pos.x - mfx, sy: pos.y - mfy });
        }
      }
      dragRef.current = { ids: dragIds, offsets, startMouse: { fx: mfx, fy: mfy } };
    } else {
      // Click on empty space: start marquee selection (unless shift for multi-select)
      if (!shift) {
        marqueeRef.current = { startX: mfx, startY: mfy, currentX: mfx, currentY: mfy, active: true };
      } else {
        // Shift + click empty: keep existing selection, no marquee
        marqueeRef.current = null;
      }
      dragRef.current = null;
    }
  }, [patchedFixtures, fixturePositions, getCanvasCoords, hitTestFixture, selectedFixtureIds, setFixturePosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Update marquee if active
    if (marqueeRef.current?.active) {
      const { fx, fy } = getCanvasCoords(e);
      marqueeRef.current.currentX = fx;
      marqueeRef.current.currentY = fy;
      return;
    }

    if (!dragRef.current) return;
    const { fx, fy } = getCanvasCoords(e);
    for (const [id, offset] of dragRef.current.offsets) {
      setFixturePosition(id, {
        x: fx + offset.sx,
        y: fy + offset.sy,
      });
    }
  }, [getCanvasCoords, setFixturePosition]);

  const handleMouseUp = useCallback(() => {
    // Finalize marquee selection
    if (marqueeRef.current?.active) {
      const m = marqueeRef.current;
      const minX = Math.min(m.startX, m.currentX);
      const maxX = Math.max(m.startX, m.currentX);
      const minY = Math.min(m.startY, m.currentY);
      const maxY = Math.max(m.startY, m.currentY);

      const newSelection = new Set(selectedFixtureIds);
      for (const pf of patchedFixtures) {
        const pos = fixturePositions[pf.id] || { x: 0.5, y: 0.3 };
        if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
          newSelection.add(pf.id);
        }
      }
      setSelectedFixtureIds(newSelection);
      marqueeRef.current = null;
      return;
    }

    dragRef.current = null;
    marqueeRef.current = null;
  }, [patchedFixtures, fixturePositions, selectedFixtureIds]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (hitTestFixture(x, y)) {
      e.preventDefault();
    }
  }, [hitTestFixture]);

  return (
    <div className="h-full flex flex-col bg-[#08080e] min-h-0 min-w-0 overflow-hidden">
      {/* Toolbar — scroll horizontal si beaucoup de boutons (≥2 sélectionnés), ne pousse jamais le canvas */}
      <div className="h-9 border-b border-gray-800/30 flex items-center px-4 gap-3 shrink-0 bg-[#0d0d14] overflow-x-auto overflow-y-hidden min-w-0 scrollbar-thin">
        <span className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
          <Maximize2 size={13} className="text-purple-400" /> Stage 2D
        </span>
        <div className="w-px h-3 bg-gray-800" />
        <span className="text-[10px] text-gray-600">
          {stageDims.width}m × {stageDims.depth}m
        </span>
        <div className="w-px h-3 bg-gray-800" />
        <button
          onClick={() => setShowBeams(v => !v)}
          className={`px-2 py-1 rounded text-[10px] transition-colors ${
            showBeams ? 'bg-purple-600/20 text-purple-400' : 'text-gray-600'
          }`}
        >
          <Eye size={11} className="inline mr-1" /> Beams
        </button>
        <button
          onClick={() => setShowLabels(v => !v)}
          className={`px-2 py-1 rounded text-[10px] transition-colors ${
            showLabels ? 'bg-purple-600/20 text-purple-400' : 'text-gray-600'
          }`}
        >
          Labels
        </button>

        {/* Alignment tools — visible when ≥2 fixtures selected */}
        {selectedFixtureIds.size >= 2 && (
          <>
            <div className="w-px h-3 bg-gray-800" />
            <span className="text-[9px] text-gray-500">{selectedFixtureIds.size} selected</span>
            <button onClick={alignVertical} title="Vertical" className="p-1 rounded text-gray-500 hover:text-purple-400 hover:bg-purple-600/20 transition-colors">
              <AlignStartVertical size={13} />
            </button>
            <button onClick={alignHorizontal} title="Horizontal" className="p-1 rounded text-gray-500 hover:text-purple-400 hover:bg-purple-600/20 transition-colors">
              <AlignStartHorizontal size={13} />
            </button>
            <button onClick={alignLeft} title="Left" className="p-1 rounded text-gray-500 hover:text-purple-400 hover:bg-purple-600/20 transition-colors">
              <AlignLeft size={13} />
            </button>
            <button onClick={alignRight} title="Align Right" className="p-1 rounded text-gray-500 hover:text-purple-400 hover:bg-purple-600/20 transition-colors">
              <AlignRight size={13} />
            </button>
            <div className="w-px h-3 bg-gray-800" />
            <button onClick={distributeHorizontal} title="Distribute Horizontally (equal spacing)" className="p-1 rounded text-gray-500 hover:text-cyan-400 hover:bg-cyan-600/20 transition-colors">
              <ArrowLeftRight size={13} />
            </button>
            <button onClick={distributeVertical} title="Distribute Vertically (equal spacing)" className="p-1 rounded text-gray-500 hover:text-cyan-400 hover:bg-cyan-600/20 transition-colors">
              <ArrowUpDown size={13} />
            </button>
          </>
        )}

        <div className="flex-1" />
        <span className="text-[9px] text-gray-600">
          Drag · Right-click height · Shift+click multi-select
        </span>
      </div>

      {/* Canvas — min-h-0/min-w-0 empêche le flex de pousser la base hors écran quand la toolbar déborde */}
      <div className="flex-1 relative min-h-0 min-w-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
          style={{ cursor: dragRef.current ? 'grabbing' : 'crosshair' }}
        />
      </div>

      {/* Floating 3D companion view */}
      {showFloating3D && (
        <div
          className="fixed z-40 bg-black/90 rounded-xl border border-purple-700/40 shadow-2xl flex flex-col"
          style={{ left: float3DPos.x, top: float3DPos.y, width: float3DSize.w, height: float3DSize.h, minWidth: 320, minHeight: 200, maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden' }}
        >
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d0d18] border-b border-gray-800 cursor-move shrink-0" onMouseDown={handleFloat3DDragStart}>
            <span className="text-[11px] text-purple-400 font-medium">🎥 Live 3D View</span>
            <div className="flex items-center gap-1">
              <button onClick={() => { setFloat3DSize({ w: 640, h: 360 }); setFloat3DPos({ x: 100, y: 80 }); }} className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded">◲</button>
              <button onClick={() => setShowFloating3D(false)} className="text-[10px] text-gray-500 hover:text-red-400 px-1.5 py-0.5 rounded">✕</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 relative">
            <Stage3D hideFixturePanel />
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
              onMouseDown={handleFloat3DResizeStart}
              style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(168,85,247,0.4) 50%)', borderBottomRightRadius: '0.75rem' }}
            />
          </div>
        </div>
      )}
      {!showFloating3D && (
        <button onClick={() => setShowFloating3D(true)} className="fixed bottom-4 right-4 z-40 bg-purple-600/80 hover:bg-purple-500 text-white rounded-full px-4 py-2 text-xs font-medium shadow-lg transition-all">
          🎥 3D View
        </button>
      )}
    </div>
  );
};
