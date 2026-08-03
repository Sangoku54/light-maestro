/**
 * Fixture Thumbnail Generator — Catalogue complet
 *
 * Canvas2D : rend des icônes 64×64 pour chaque type/variante de fixture.
 * Les data URLs sont cachées, le composant n'appelle que getVariantsForCategory().
 */

export interface ThumbnailVariant {
  id: string;
  label: string;
  description: string;
  dataUrl: string;
  category: string;
}

// ─── Cache ───────────────────────────────────────────────────

let _cache: ThumbnailVariant[] | null = null;
const SZ = 80; // plus grand pour meilleure qualité

// ─── Canvas helpers ──────────────────────────────────────────

function mkCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = SZ; c.height = SZ;
  return [c, c.getContext('2d')!];
}

function push(
  list: ThumbnailVariant[],
  id: string, label: string, desc: string, cat: string,
  drawFn: (ctx: CanvasRenderingContext2D) => void,
) {
  const [c, ctx] = mkCanvas();
  drawFn(ctx);
  list.push({ id, label, description: desc, dataUrl: c.toDataURL(), category: cat });
}

function beamGradient(ctx: CanvasRenderingContext2D, x: number, y: number, dy: number, color: string) {
  const g = ctx.createLinearGradient(0, y, 0, y + dy);
  g.addColorStop(0, color); g.addColorStop(1, 'transparent');
  return g;
}

// ═══════════════════════════════════════════════════════════════
//  MOVING HEADS
// ═══════════════════════════════════════════════════════════════

function drawMovingHead(ctx: CanvasRenderingContext2D, body: string, lens: string, beam: string, tiltDeg: number) {
  const c = SZ / 2;
  ctx.fillStyle = '#222233';
  ctx.beginPath(); ctx.ellipse(c, c + 20, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3a3a4e'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(c - 14, c + 6); ctx.lineTo(c - 9, c - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c + 14, c + 6); ctx.lineTo(c + 9, c - 4); ctx.stroke();
  ctx.save(); ctx.translate(c, c - 7); ctx.rotate(tiltDeg * Math.PI / 180);
  ctx.fillStyle = body; ctx.fillRect(-9, -15, 18, 30);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(-9, -15, 18, 30);
  ctx.fillStyle = lens;
  ctx.beginPath(); ctx.ellipse(0, -15, 6, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = beamGradient(ctx, 0, -15, -36, beam);
  ctx.beginPath(); ctx.moveTo(-6, -15); ctx.lineTo(6, -15); ctx.lineTo(3, -50); ctx.lineTo(-3, -50); ctx.fill();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
//  STATIC FIXTURES (PAR, LED, etc.)
// ═══════════════════════════════════════════════════════════════

function drawPar(ctx: CanvasRenderingContext2D, body: string, face: string, leds: boolean) {
  const c = SZ / 2;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(c - 18, c + 20); ctx.lineTo(c - 20, c - 5);
  ctx.quadraticCurveTo(c - 15, c - 13, c, c - 13);
  ctx.quadraticCurveTo(c + 15, c - 13, c + 20, c - 5);
  ctx.lineTo(c + 18, c + 20);
  ctx.fill();
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = face;
  ctx.beginPath(); ctx.ellipse(c, c - 7, 13, 6, 0, 0, Math.PI * 2); ctx.fill();
  if (leds) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
      ctx.fillStyle = `hsl(${i * 50}, 70%, 55%)`;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * 6, c - 7 + Math.sin(a) * 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(c, c + 10); ctx.lineTo(c, c + 18); ctx.stroke();
}

function drawLedBar(ctx: CanvasRenderingContext2D, segments: number, vertical: boolean) {
  const c = SZ / 2;
  ctx.fillStyle = '#1a1a2e';
  if (vertical) {
    ctx.fillRect(c - 6, c - 28, 12, 56);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1; ctx.strokeRect(c - 6, c - 28, 12, 56);
    const hs = 48 / segments;
    for (let i = 0; i < segments; i++) {
      ctx.fillStyle = `hsl(${i * 60}, 80%, 60%)`;
      ctx.fillRect(c - 4, c - 26 + i * hs + 2, 8, hs - 4);
    }
  } else {
    ctx.fillRect(c - 28, c - 6, 56, 12);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1; ctx.strokeRect(c - 28, c - 6, 56, 12);
    const ws = 48 / segments;
    for (let i = 0; i < segments; i++) {
      ctx.fillStyle = `hsl(${i * 60}, 80%, 60%)`;
      ctx.fillRect(c - 26 + i * ws + 2, c - 4, ws - 4, 8);
    }
  }
}

function drawPanel(ctx: CanvasRenderingContext2D, cols: number, rows: number) {
  const c = SZ / 2;
  ctx.fillStyle = '#1a1a2e';
  const pw = cols * 10 + 8, ph = rows * 10 + 8;
  ctx.fillRect(c - pw / 2, c - ph / 2, pw, ph);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(c - pw / 2, c - ph / 2, pw, ph);
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      ctx.fillStyle = `hsl(${(x + y) * 40}, 70%, 55%)`;
      ctx.fillRect(c - pw / 2 + 5 + x * 10, c - ph / 2 + 5 + y * 10, 8, 8);
    }
  }
}

function drawLaser(ctx: CanvasRenderingContext2D, color: string, multiBeam: boolean) {
  const c = SZ / 2;
  ctx.fillStyle = '#1a1a2e'; ctx.fillRect(c - 12, c - 8, 24, 20);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(c - 12, c - 8, 24, 20);
  ctx.fillStyle = '#333'; ctx.fillRect(c - 6, c + 12, 12, 4);
  const beams = multiBeam ? [-2, -1, 0, 1, 2] : [0];
  for (const b of beams) {
    const g = beamGradient(ctx, c + b * 6, c + 15, 24, color);
    ctx.strokeStyle = g; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(c, c + 15); ctx.lineTo(c + b * 8, c + 38); ctx.stroke();
  }
}

function drawStrobe(ctx: CanvasRenderingContext2D, face: string, tubes: number) {
  const c = SZ / 2;
  ctx.fillStyle = '#1a1a2e'; ctx.fillRect(c - 20, c - 6, 40, 22);
  ctx.strokeStyle = '#555'; ctx.strokeRect(c - 20, c - 6, 40, 22);
  const tw = 36 / tubes;
  for (let i = 0; i < tubes; i++) {
    ctx.fillStyle = face;
    ctx.fillRect(c - 18 + i * tw + 2, c - 4, tw - 4, 16);
  }
  const ring = ctx.createRadialGradient(c, c - 18, 0, c, c - 18, 18);
  ring.addColorStop(0, 'rgba(255,255,255,0.5)'); ring.addColorStop(1, 'transparent');
  ctx.fillStyle = ring;
  ctx.beginPath(); ctx.arc(c, c - 18, 18, 0, Math.PI * 2); ctx.fill();
}

function drawSmoke(ctx: CanvasRenderingContext2D, color: string) {
  const c = SZ / 2;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(c - 8, c + 6, 14, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(c + 6, c, 16, 14, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(c, c - 8, 11, 16, -0.2, 0, Math.PI * 2); ctx.fill();
}

function drawFlowerEffect(ctx: CanvasRenderingContext2D) {
  const c = SZ / 2;
  // Base
  ctx.fillStyle = '#1a1a2e'; ctx.fillRect(c - 14, c + 2, 28, 14);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(c - 14, c + 2, 28, 14);
  // Lens aperture
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.ellipse(c, c - 2, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
  // Petals
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = `hsla(${i * 50 + 280}, 70%, 60%, 0.6)`;
    ctx.beginPath();
    ctx.ellipse(c + Math.cos(a) * 10, c - 10 + Math.sin(a) * 8, 6, 3, a, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPinspot(ctx: CanvasRenderingContext2D) {
  const c = SZ / 2;
  ctx.fillStyle = '#1a1a2e'; ctx.fillRect(c - 8, c - 2, 16, 22);
  ctx.strokeStyle = '#555'; ctx.strokeRect(c - 8, c - 2, 16, 22);
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.arc(c, c - 4, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = beamGradient(ctx, 0, c - 8, -24, 'rgba(255,255,255,0.6)');
  ctx.beginPath(); ctx.moveTo(-4, c - 8); ctx.lineTo(4, c - 8); ctx.lineTo(2, c - 30); ctx.lineTo(-2, c - 30); ctx.fill();
}

function drawMirrorBall(ctx: CanvasRenderingContext2D) {
  const c = SZ / 2;
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(c, c - 30); ctx.lineTo(c, c - 18); ctx.stroke();
  ctx.fillStyle = '#ddd';
  ctx.beginPath(); ctx.arc(c, c - 4, 12, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    ctx.fillStyle = i % 2 === 0 ? '#fff' : '#ccc';
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * 9, c - 4 + Math.sin(a) * 9, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ═══════════════════════════════════════════════════════════════

export function generateAllThumbnails(): ThumbnailVariant[] {
  if (_cache) return _cache;

  const V: ThumbnailVariant[] = [];

  // ── Moving Heads ──
  push(V, 'mh-spot', 'Spot', 'Faisceau concentré motorisé', 'moving_head',
    ctx => drawMovingHead(ctx, '#2a2a3e', '#d0d0d0', 'rgba(31,135,223,0.5)', 0));
  push(V, 'mh-wash', 'Wash', 'Éclairage large motorisé', 'moving_head',
    ctx => drawMovingHead(ctx, '#3a2a3e', '#e0e0e0', 'rgba(180,130,255,0.4)', -12));
  push(V, 'mh-beam', 'Beam', 'Faisceau serré / Beam', 'moving_head',
    ctx => drawMovingHead(ctx, '#1a1a3e', '#f0f0f0', 'rgba(200,200,255,0.6)', 0));
  push(V, 'mh-hybrid', 'Hybrid', 'Spot/Wash/Beam hybride', 'moving_head',
    ctx => drawMovingHead(ctx, '#2a3a3e', '#ddd', 'rgba(100,200,255,0.5)', -5));
  push(V, 'mh-par', 'Moving PAR', 'PAR motorisé 3 axes', 'moving_head',
    ctx => drawMovingHead(ctx, '#3a3a2a', '#ffdd88', 'rgba(255,200,100,0.4)', -20));

  // ── Scanners ──
  push(V, 'scanner-barrel', 'Scanner', 'Scanner à miroir', 'scanner',
    ctx => drawMovingHead(ctx, '#1a2a3e', '#88ccff', 'rgba(100,200,255,0.4)', 5));

  // ── LED PARs ──
  push(V, 'par-can', 'PAR Can 64', 'PAR classique 64', 'led_par',
    ctx => drawPar(ctx, '#2a2a3e', '#333', false));
  push(V, 'par-flat', 'Flat PAR', 'PAR plat LED', 'led_par',
    ctx => drawPar(ctx, '#1a1a2e', '#1a1a3e', true));
  push(V, 'par-rgb', 'PAR RGB', 'PAR LED RGB', 'led_par',
    ctx => drawPar(ctx, '#1a1a2e', '#111', true));
  push(V, 'par-uv', 'PAR UV', 'PAR ultraviolet', 'led_par',
    ctx => drawPar(ctx, '#1a1a1a', '#220033', false));

  // ── LED Bars ──
  push(V, 'led-bar-4', 'Barre LED 4', 'Barre 4 segments', 'led_bar',
    ctx => drawLedBar(ctx, 4, true));
  push(V, 'led-bar-8', 'Barre LED 8', 'Barre 8 segments', 'led_bar',
    ctx => drawLedBar(ctx, 8, true));
  push(V, 'led-bar-h', 'Barre LED Horiz.', 'Barre horizontale', 'led_bar',
    ctx => drawLedBar(ctx, 6, false));

  // ── Panels / Matrices ──
  push(V, 'panel-2x2', 'Panel 2×2', 'Matrice 2×2', 'panel',
    ctx => drawPanel(ctx, 2, 2));
  push(V, 'panel-4x4', 'Panel 4×4', 'Matrice 4×4', 'panel',
    ctx => drawPanel(ctx, 4, 4));
  push(V, 'panel-5x5', 'Panel 5×5', 'Matrice 5×5', 'panel',
    ctx => drawPanel(ctx, 5, 5));

  // ── Lasers ──
  push(V, 'laser-red', 'Laser Rouge', 'Laser simple rouge', 'laser',
    ctx => drawLaser(ctx, '#ff3333', false));
  push(V, 'laser-green', 'Laser Vert', 'Laser simple vert', 'laser',
    ctx => drawLaser(ctx, '#33ff33', false));
  push(V, 'laser-rgb', 'Laser RGB', 'Laser RVB multi-fx', 'laser',
    ctx => drawLaser(ctx, '#ff00ff', true));
  push(V, 'laser-bar', 'Barre Laser', 'Barre de lasers', 'laser',
    ctx => drawLaser(ctx, '#00ccff', true));

  // ── Strobes ──
  push(V, 'strobe-1', 'Strobe Simple', 'Stroboscope 1 tube', 'strobe',
    ctx => drawStrobe(ctx, '#eee', 1));
  push(V, 'strobe-2', 'Blinder 2', 'Blinder 2 lampes', 'strobe',
    ctx => drawStrobe(ctx, '#ffffcc', 2));
  push(V, 'strobe-4', 'Blinder 4', 'Blinder 4 lampes', 'strobe',
    ctx => drawStrobe(ctx, '#ffffff', 4));
  push(V, 'strobe-atomic', 'Atomic', 'Strobe Atomic 3000', 'strobe',
    ctx => drawStrobe(ctx, '#ffcc00', 1));

  // ── Smoke / Haze ──
  push(V, 'smoke', 'Machine Fumée', 'Fumée épaisse', 'smoke',
    ctx => drawSmoke(ctx, 'rgba(180,180,200,0.35)'));
  push(V, 'haze', 'Hazer', 'Haze fine / atmosphère', 'smoke',
    ctx => drawSmoke(ctx, 'rgba(200,200,220,0.2)'));
  push(V, 'low-fog', 'Low Fog', 'Fumée au sol / CO2', 'smoke',
    ctx => { ctx.fillStyle = 'rgba(180,180,200,0.3)'; ctx.fillRect(0, SZ / 2, SZ, SZ / 2); });

  // ── Special Effects ──
  push(V, 'pinspot', 'Pinspot', 'Spot miroir boule', 'special',
    ctx => drawPinspot(ctx));
  push(V, 'mirror-ball', 'Boule à Facettes', 'Miroir rotatif', 'special',
    ctx => drawMirrorBall(ctx));
  push(V, 'flower', 'Flower Effect', 'Effet fleur / LED', 'special',
    ctx => drawFlowerEffect(ctx));
  push(V, 'uv-bar', 'Barre UV', 'Barre ultraviolet', 'special',
    ctx => drawLedBar(ctx, 4, true)); // reuse bar with purple tones — simple

  _cache = V;
  return V;
}

// ─── Mapping fixture types → catégories ──────────────────────

const TYPE_TO_CAT: Record<string, string> = {
  'moving head': 'moving_head', 'moving_head': 'moving_head', 'moving yoke': 'moving_head',
  'scanner': 'scanner',
  'led par': 'led_par', 'led_par': 'led_par', 'par': 'led_par', 'dimmer': 'led_par',
  'color changer': 'led_par', 'colour changer': 'led_par',
  'led bar': 'led_bar', 'led_bar': 'led_bar', 'bar': 'led_bar',
  'panel': 'panel', 'matrix': 'panel', 'led panel': 'panel',
  'laser': 'laser',
  'strobe': 'strobe', 'shutter': 'strobe', 'blinder': 'strobe',
  'smoke': 'smoke', 'haze': 'smoke', 'fog': 'smoke', 'hazer': 'smoke',
  'effect': 'special', 'flower': 'special', 'pinspot': 'special',
  'mirror ball': 'special', 'mirrorball': 'special',
  'led': 'led_par', // fallback générique
};

/**
 * Retourne TOUS les variants, mais triés :
 * ceux de la catégorie matching d'abord, puis toutes les autres catégories.
 */
export function getVariantsForCategory(category: string): ThumbnailVariant[] {
  const all = generateAllThumbnails();
  const cat = TYPE_TO_CAT[category.toLowerCase()] || 'led_par';

  // Séparer : d'abord ceux de la bonne catégorie, puis le reste
  const matching = all.filter(v => v.category === cat);
  const others = all.filter(v => v.category !== cat);

  return [...matching, ...others];
}
