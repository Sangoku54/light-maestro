/**
 * Stage2DEditor — 2D Stage positioning editor for the Design sidebar
 *
 * Shows a top-down 2D stage view with all patched fixtures.
 * Click+drag to reposition, right-click to set height.
 * Positions are persisted in useShowStore.fixturePositions (shared with Stage3D).
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShowStore, getFixtureColor, type PatchedFixture } from '../stores/showStore';
import { Eye, Maximize2 } from 'lucide-react';

const STAGE_W = 10;
const STAGE_D = 8;

export const Stage2DEditor: React.FC = () => {
  const { t } = useTranslation();
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const fixturePositions = useShowStore((s) => s.fixturePositions);
  const setFixturePosition = useShowStore((s) => s.setFixturePosition);
  const initFixturePosition = useShowStore((s) => s.initFixturePosition);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const dragRef = useRef<{ id: string; sx: number; sy: number } | null>(null);
  const [showBeams, setShowBeams] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

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
    const pad = 48;
    const sw = W - pad * 2;
    const sh = H - pad * 2;

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0a0a14';
      ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 0.5;
      const cols = STAGE_W;
      const rows = STAGE_D;
      for (let i = 0; i <= cols; i++) {
        const x = pad + (i / cols) * sw;
        ctx.beginPath();
        ctx.moveTo(x, pad);
        ctx.lineTo(x, pad + sh);
        ctx.stroke();
      }
      for (let i = 0; i <= rows; i++) {
        const y = pad + (i / rows) * sh;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + sw, y);
        ctx.stroke();
      }

      // Stage border
      ctx.strokeStyle = '#3a3a5e';
      ctx.lineWidth = 2;
      ctx.strokeRect(pad, pad, sw, sh);

      // Stage label
      ctx.fillStyle = '#3a3a5e';
      ctx.font = '10px monospace';
      ctx.fillText(`${STAGE_W}m × ${STAGE_D}m`, pad + 6, pad + 14);

      // Direction labels
      ctx.fillStyle = '#4a4a6e';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FRONT (Audience ↓)', W / 2, pad - 8);
      ctx.textAlign = 'left';
      ctx.fillText('BACK', pad + sw / 2 - 16, pad + sh + 14);

      // Fixtures
      for (let i = 0; i < patchedFixtures.length; i++) {
        const pf = patchedFixtures[i];
        const pos = fixturePositions[pf.id] || { x: 0.5, y: 0.3, h: 0.5, heading: 0 };
        const fx = pad + pos.x * sw;
        const fy = pad + pos.y * sh;
        const r = 16;
        const color = getFixtureColor(i);

        // Beam cone
        if (showBeams) {
          const beamLen = 50;
          ctx.save();
          ctx.globalAlpha = 0.08;
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

        // Circle
        ctx.beginPath();
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a2ecc';
        ctx.fill();

        // Tier border
        const tierBorderColor =
          pf.tier === 'primary' ? '#a855f7' :
          pf.tier === 'secondary' ? '#3b82f6' : '#6b7280';
        ctx.strokeStyle = tierBorderColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Inner circle (color dot)
        ctx.beginPath();
        ctx.arc(fx, fy, r - 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Height indicator (small bar on side)
        const hBarH = Math.max(2, pos.h * 16);
        ctx.fillStyle = '#ffffff33';
        ctx.fillRect(fx + r + 3, fy - hBarH / 2, 3, hBarH);

        // Label
        if (showLabels) {
          const label = pf.name.length > 14 ? pf.name.slice(0, 13) + '…' : pf.name;
          ctx.fillStyle = '#9ca3af';
          ctx.font = '9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(label, fx, fy + r + 13);

          // Tier badge
          const tierBadge = pf.tier === 'primary' ? 'P' : pf.tier === 'secondary' ? 'S' : 'T';
          ctx.fillStyle = tierBorderColor;
          ctx.font = 'bold 8px Inter, sans-serif';
          ctx.fillText(tierBadge, fx, fy - r - 7);

          // Height text
          ctx.fillStyle = '#5a5a7e';
          ctx.font = '7px Inter, sans-serif';
          ctx.fillText(`${(pos.h * 5.0).toFixed(1)}m`, fx, fy - r - 16);

          // Heading arrow (points forward direction)
          if (pos.heading !== undefined) {
            const hRad = (pos.heading * Math.PI) / 180;
            const arrowLen = r + 8;
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
  }, [patchedFixtures, fixturePositions, showBeams, showLabels]);

  // ── Mouse handlers ──
  const getCanvasCoords = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { fx: 0, fy: 0 };
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pad = 48;
    const sw = rect.width - 96;
    const sh = rect.height - 96;
    return { fx: (x - pad) / sw, fy: (y - pad) / sh };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pad = 48;
    const sw = rect.width - 96;
    const sh = rect.height - 96;

    for (const pf of patchedFixtures) {
      const pos = fixturePositions[pf.id] || { x: 0.5, y: 0.3, h: 0.5, heading: 0 };
      const fx = pad + pos.x * sw;
      const fy = pad + pos.y * sh;
      if (Math.hypot(x - fx, y - fy) < 20) {
        if (e.button === 2 || e.button === 0) {
          // Right-click: cycle height preset
          if (e.button === 2) {
            e.preventDefault();
            const heights = [0.1, 0.3, 0.5, 0.6, 0.8, 1.0];
            const currentIdx = heights.findIndex(h => Math.abs(h - pos.h) < 0.02);
            const nextIdx = (currentIdx + 1) % heights.length;
            setFixturePosition(pf.id, { h: heights[nextIdx] });
            return;
          }
          // Left-click: start drag
          const { fx: mfx, fy: mfy } = getCanvasCoords(e);
          dragRef.current = { id: pf.id, sx: pos.x - mfx, sy: pos.y - mfy };
        }
        return;
      }
    }
    dragRef.current = null;
  }, [patchedFixtures, fixturePositions, getCanvasCoords, setFixturePosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const { fx, fy } = getCanvasCoords(e);
    setFixturePosition(dragRef.current.id, {
      x: Math.max(0, Math.min(1, fx + dragRef.current.sx)),
      y: Math.max(0, Math.min(1, fy + dragRef.current.sy)),
    });
  }, [getCanvasCoords, setFixturePosition]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Prevent default context menu for right-click height cycling
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pad = 48;
    const sw = rect.width - 96;
    const sh = rect.height - 96;

    for (const pf of patchedFixtures) {
      const pos = fixturePositions[pf.id] || { x: 0.5, y: 0.3, h: 0.5, heading: 0 };
      const fx = pad + pos.x * sw;
      const fy = pad + pos.y * sh;
      if (Math.hypot(x - fx, y - fy) < 20) {
        e.preventDefault();
        return;
      }
    }
  }, [patchedFixtures, fixturePositions]);

  return (
    <div className="h-full flex flex-col bg-[#08080e]">
      {/* Toolbar */}
      <div className="h-9 border-b border-gray-800/30 flex items-center px-4 gap-3 shrink-0 bg-[#0d0d14]">
        <span className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
          <Maximize2 size={13} className="text-purple-400" /> Stage 2D
        </span>
        <div className="w-px h-3 bg-gray-800" />
        <span className="text-[10px] text-gray-600">
          {STAGE_W}m × {STAGE_D}m
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
        <div className="flex-1" />
        <span className="text-[9px] text-gray-600">
          Drag to position · Right-click to set height
        </span>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
          style={{ cursor: dragRef.current ? 'grabbing' : 'crosshair' }}
        />
      </div>
    </div>
  );
};
