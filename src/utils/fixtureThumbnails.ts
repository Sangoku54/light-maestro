/**
 * Fixture Thumbnail Generator — Catalogue complet
 *
 * Canvas2D : rend des icônes 80×80 réalistes pour chaque type/variante de
 * fixture (corps métallisés en dégradé, lentilles lumineuses, faisceaux en
 * dégradé, socles/équerres). Les data URLs sont cachées, le composant
 * n'appelle que getVariantsForCategory().
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
  // Filet : un drawer défaillant ne doit JAMAIS crasher l'app (les thumbnails
  // sont générés au démarrage — une exception ici = écran blanc).
  try {
    drawFn(ctx);
  } catch (e) {
    console.warn(`[fixtureThumbnails] draw ${id} failed:`, e);
    ctx.fillStyle = '#2a2a3e';
    roundRect(ctx, 8, 8, SZ - 16, SZ - 16, 6);
    ctx.fill();
  }
  list.push({ id, label, description: desc, dataUrl: c.toDataURL(), category: cat });
}

/** Corps métallisé vertical : dégradé sombre → clair → sombre. */
function metalBody(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  tint = '#2a2a3e', radius = 4,
): void {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#15151f');
  g.addColorStop(0.35, tint);
  g.addColorStop(0.55, '#4a4a62');
  g.addColorStop(1, '#101018');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, radius);
  ctx.stroke();
  // Reflet vertical
  const hl = ctx.createLinearGradient(x, y, x, y + h);
  hl.addColorStop(0, 'rgba(255,255,255,0.18)');
  hl.addColorStop(0.3, 'rgba(255,255,255,0.05)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  roundRect(ctx, x + 2, y + 2, Math.max(2, w * 0.22), h - 4, 2);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Lentille lumineuse : disque en dégradé radial (cœur brillant). */
function lensGlow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  core: string, edge = 'rgba(255,255,255,0.05)',
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, core);
  g.addColorStop(1, edge);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}

function beamGradient(ctx: CanvasRenderingContext2D, x: number, y: number, dy: number, color: string) {
  const g = ctx.createLinearGradient(0, y, 0, y + dy);
  g.addColorStop(0, color); g.addColorStop(1, 'transparent');
  return g;
}

/** Socle / équerre commune. */
function baseStand(ctx: CanvasRenderingContext2D, cx: number, cy: number, w = 22): void {
  const g = ctx.createLinearGradient(cx - w / 2, cy, cx + w / 2, cy + 4);
  g.addColorStop(0, '#181820'); g.addColorStop(0.5, '#2e2e3c'); g.addColorStop(1, '#12121a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, 5, 0, 0, Math.PI * 2); ctx.fill();
}

// ═══════════════════════════════════════════════════════════════
//  MOVING HEADS
// ═══════════════════════════════════════════════════════════════

function drawMovingHead(ctx: CanvasRenderingContext2D, body: string, lens: string, beam: string, tiltDeg: number) {
  const c = SZ / 2;
  baseStand(ctx, c, c + 21, 24);
  // Yoke en U métallique
  ctx.strokeStyle = '#3a3a4e'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(c - 14, c + 8); ctx.lineTo(c - 9, c - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c + 14, c + 8); ctx.lineTo(c + 9, c - 4); ctx.stroke();
  ctx.save(); ctx.translate(c, c - 7); ctx.rotate(tiltDeg * Math.PI / 180);
  metalBody(ctx, -9, -15, 18, 30, body, 3);
  // Lentille brillante + halo
  lensGlow(ctx, 0, -15, 7, lens);
  // Faisceau en dégradé (plus large à la base du halo)
  const bg = ctx.createLinearGradient(0, -15, 0, -50);
  bg.addColorStop(0, beam);
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.moveTo(-6, -15); ctx.lineTo(6, -15); ctx.lineTo(4, -50); ctx.lineTo(-4, -50); ctx.fill();
  ctx.restore();
}

/** Follow spot : long tube sur trépied, faisceau blanc puissant. */
function drawFollowSpot(ctx: CanvasRenderingContext2D) {
  const c = SZ / 2;
  // Trépied
  ctx.strokeStyle = '#3a3a4e'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(c - 6, c + 6); ctx.lineTo(c - 18, c + 34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c + 6, c + 6); ctx.lineTo(c + 18, c + 34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c, c + 8); ctx.lineTo(c, c + 36); ctx.stroke();
  // Tube long incliné vers le haut-droite
  ctx.save(); ctx.translate(c, c + 2); ctx.rotate(-0.5);
  metalBody(ctx, -26, -7, 54, 14, '#2f3542', 5);
  lensGlow(ctx, 28, 0, 6, '#e8f0ff');
  const bg = ctx.createLinearGradient(30, 0, 34, -30);
  bg.addColorStop(0, 'rgba(255,255,240,0.55)'); bg.addColorStop(1, 'rgba(255,255,240,0)');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.moveTo(30, -5); ctx.lineTo(34, -5); ctx.lineTo(22, -34); ctx.lineTo(14, -30); ctx.fill();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
//  STATIC FIXTURES (PAR, FRESNEL, WASHER…)
// ═══════════════════════════════════════════════════════════════

function drawPar(ctx: CanvasRenderingContext2D, body: string, face: string, leds: boolean) {
  const c = SZ / 2;
  // Corps PAR en dégradé métallique
  const g = ctx.createLinearGradient(c - 20, 0, c + 20, 0);
  g.addColorStop(0, '#14141c'); g.addColorStop(0.4, body); g.addColorStop(0.75, '#454558'); g.addColorStop(1, '#0e0e14');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(c - 18, c + 20); ctx.lineTo(c - 20, c - 5);
  ctx.quadraticCurveTo(c - 15, c - 13, c, c - 13);
  ctx.quadraticCurveTo(c + 15, c - 13, c + 20, c - 5);
  ctx.lineTo(c + 18, c + 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  // Face lumineuse
  lensGlow(ctx, c, c - 7, 13, face, 'rgba(255,255,255,0.03)');
  if (leds) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
      ctx.fillStyle = `hsl(${i * 50}, 85%, 62%)`;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * 6, c - 7 + Math.sin(a) * 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Yoke + stand
  ctx.strokeStyle = '#3a3a4e'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(c - 12, c + 12); ctx.lineTo(c - 8, c + 22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c + 12, c + 12); ctx.lineTo(c + 8, c + 22); ctx.stroke();
}

/** Fresnel / théâtre : boîtier carré, patères, volets, halo chaud. */
function drawFresnel(ctx: CanvasRenderingContext2D, warm: boolean) {
  const c = SZ / 2;
  metalBody(ctx, c - 17, c - 14, 34, 30, '#3a3226', 3);
  // Volets métalliques
  ctx.strokeStyle = '#1a1a24'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(c - 17, c - 6); ctx.lineTo(c - 24, c - 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c + 17, c - 6); ctx.lineTo(c + 24, c - 10); ctx.stroke();
  // Lentille fresnel (cercle strié)
  lensGlow(ctx, c, c + 1, 11, warm ? '#ffdd99' : '#dfe8ff');
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.arc(c, c + 1, 3 + Math.abs(i) * 2.4, -0.8, 0.8); ctx.stroke();
  }
  // Patère + câble
  ctx.strokeStyle = '#4a4a5e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(c, c - 14); ctx.lineTo(c, c - 22); ctx.stroke();
  ctx.beginPath(); ctx.arc(c, c - 24, 2.5, 0, Math.PI * 2); ctx.stroke();
  // Halo chaud
  const glow = ctx.createRadialGradient(c, c + 1, 4, c, c + 1, 20);
  glow.addColorStop(0, warm ? 'rgba(255,220,150,0.28)' : 'rgba(210,230,255,0.22)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(c, c + 1, 20, 0, Math.PI * 2); ctx.fill();
}

/** Wall washer : barre large au sol, lavage ascendant en éventail. */
function drawWallWasher(ctx: CanvasRenderingContext2D, leds: number) {
  const c = SZ / 2;
  // Éventail de lavage (dégradé ascendant)
  const wg = ctx.createLinearGradient(0, c - 30, 0, c + 8);
  wg.addColorStop(0, 'rgba(120,180,255,0)');
  wg.addColorStop(0.7, 'rgba(120,180,255,0.25)');
  wg.addColorStop(1, 'rgba(160,200,255,0.5)');
  ctx.fillStyle = wg;
  ctx.beginPath();
  ctx.moveTo(c - 30, c + 8); ctx.lineTo(c + 30, c + 8);
  ctx.lineTo(c + 16, c - 30); ctx.lineTo(c - 16, c - 30);
  ctx.closePath(); ctx.fill();
  // Corps incliné
  ctx.save(); ctx.translate(c, c + 8); ctx.rotate(-0.18);
  metalBody(ctx, -27, -6, 54, 12, '#232334', 4);
  for (let i = 0; i < leds; i++) {
    lensGlow(ctx, -21 + i * (42 / (leds - 1)), 0, 4, '#a8c8ff');
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
//  BARS / SPIDERS / PANELS
// ═══════════════════════════════════════════════════════════════

function drawLedBar(ctx: CanvasRenderingContext2D, segments: number, vertical: boolean) {
  const c = SZ / 2;
  const drawBody = (x: number, y: number, w: number, h: number) => {
    metalBody(ctx, x, y, w, h, '#1c1c2c', 3);
  };
  if (vertical) {
    drawBody(c - 7, c - 28, 14, 56);
    const hs = 48 / segments;
    for (let i = 0; i < segments; i++) {
      lensGlow(ctx, c, c - 26 + i * hs + hs / 2, 4.5, `hsl(${i * 60}, 85%, 62%)`);
    }
  } else {
    drawBody(c - 28, c - 7, 56, 14);
    const ws = 48 / segments;
    for (let i = 0; i < segments; i++) {
      lensGlow(ctx, c - 26 + i * ws + ws / 2, c, 4.5, `hsl(${i * 60}, 85%, 62%)`);
    }
  }
}

/** Spider / multi-beam : N faisceaux parallèles serrés. */
function drawSpider(ctx: CanvasRenderingContext2D, beams: number) {
  const c = SZ / 2;
  baseStand(ctx, c, c + 22, 26);
  metalBody(ctx, c - 24, c + 4, 48, 12, '#1c1c30', 4);
  const step = 40 / (beams - 1);
  for (let i = 0; i < beams; i++) {
    const x = c - 20 + i * step;
    lensGlow(ctx, x, c + 4, 3.5, '#cfd8ff');
    const bg = ctx.createLinearGradient(0, c + 4, 0, c - 40);
    bg.addColorStop(0, 'rgba(180,190,255,0.55)');
    bg.addColorStop(1, 'rgba(180,190,255,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(x - 3, c + 4); ctx.lineTo(x + 3, c + 4); ctx.lineTo(x + 1.5, c - 40); ctx.lineTo(x - 1.5, c - 40); ctx.fill();
  }
}

function drawPanel(ctx: CanvasRenderingContext2D, cols: number, rows: number) {
  const c = SZ / 2;
  const pw = cols * 10 + 8, ph = rows * 10 + 8;
  metalBody(ctx, c - pw / 2, c - ph / 2, pw, ph, '#181826', 4);
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      lensGlow(ctx, c - pw / 2 + 9 + x * 10, c - ph / 2 + 9 + y * 10, 4, `hsl(${(x + y) * 40}, 80%, 58%)`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  LASERS / STROBES / FX
// ═══════════════════════════════════════════════════════════════

function drawLaser(ctx: CanvasRenderingContext2D, color: string, multiBeam: boolean) {
  const c = SZ / 2;
  baseStand(ctx, c, c + 14, 26);
  metalBody(ctx, c - 13, c - 9, 26, 21, '#20202e', 3);
  lensGlow(ctx, c, c + 14, 3.5, color);
  const beams = multiBeam ? [-2, -1, 0, 1, 2] : [0];
  for (const b of beams) {
    const g = beamGradient(ctx, c + b * 6, c + 15, 24, color);
    ctx.strokeStyle = g; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(c, c + 15); ctx.lineTo(c + b * 8, c + 38); ctx.stroke();
  }
}

function drawStrobe(ctx: CanvasRenderingContext2D, face: string, tubes: number) {
  const c = SZ / 2;
  metalBody(ctx, c - 20, c - 6, 40, 22, '#202030', 3);
  const tw = 36 / tubes;
  for (let i = 0; i < tubes; i++) {
    lensGlow(ctx, c - 18 + i * tw + tw / 2, c + 5, tw / 2 - 2, face, 'rgba(255,255,255,0.02)');
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
  baseStand(ctx, c, c + 16, 30);
  metalBody(ctx, c - 14, c + 2, 28, 14, '#20202e', 3);
  lensGlow(ctx, c, c - 2, 8, '#3a3a48');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = `hsla(${i * 50 + 280}, 75%, 62%, 0.65)`;
    ctx.beginPath();
    ctx.ellipse(c + Math.cos(a) * 10, c - 10 + Math.sin(a) * 8, 6, 3, a, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPinspot(ctx: CanvasRenderingContext2D) {
  const c = SZ / 2;
  metalBody(ctx, c - 8, c - 2, 16, 22, '#232334', 3);
  lensGlow(ctx, c, c - 4, 5, '#cfd8ff');
  ctx.fillStyle = beamGradient(ctx, 0, c - 8, -24, 'rgba(255,255,255,0.6)');
  ctx.beginPath(); ctx.moveTo(c - 4, c - 8); ctx.lineTo(c + 4, c - 8); ctx.lineTo(c + 2, c - 30); ctx.lineTo(c - 2, c - 30); ctx.fill();
}

function drawMirrorBall(ctx: CanvasRenderingContext2D) {
  const c = SZ / 2;
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(c, c - 30); ctx.lineTo(c, c - 18); ctx.stroke();
  // Boule en dégradé + facettes
  const g = ctx.createRadialGradient(c - 4, c - 8, 2, c, c - 4, 13);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#cfcfd8'); g.addColorStop(1, '#8f8f9c');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(c, c - 4, 12, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(170,170,185,0.85)';
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * 9, c - 4 + Math.sin(a) * 9, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Derby / effet balayage : faisceaux colorés en éventail. */
function drawDerby(ctx: CanvasRenderingContext2D) {
  const c = SZ / 2;
  baseStand(ctx, c, c + 16, 30);
  metalBody(ctx, c - 18, c + 2, 36, 12, '#242434', 4);
  const colors = ['#ff4444', '#44ff88', '#4488ff', '#ffcc44'];
  for (let i = 0; i < 4; i++) {
    const x = c - 13 + i * 9;
    lensGlow(ctx, x, c + 2, 3.5, colors[i]);
    const ang = (i - 1.5) * 0.22;
    const dx = Math.sin(ang) * 30, dy = -Math.cos(ang) * 30;
    const g2 = ctx.createLinearGradient(x, c, x + dx, c + dy);
    g2.addColorStop(0, `hsla(${i * 55 + 340}, 90%, 60%, 0.5)`);
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = g2; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x, c); ctx.lineTo(x + dx, c + dy); ctx.stroke();
  }
}

/** Ventilateur / machine à vent. */
function drawFan(ctx: CanvasRenderingContext2D) {
  const c = SZ / 2;
  baseStand(ctx, c, c + 18, 24);
  metalBody(ctx, c - 12, c + 2, 24, 16, '#232334', 3);
  // Grille circulaire + pales
  ctx.strokeStyle = '#5a5a70'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c, c - 8, 13, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    ctx.fillStyle = 'rgba(180,190,220,0.75)';
    ctx.beginPath();
    ctx.ellipse(c + Math.cos(a) * 6, c - 8 + Math.sin(a) * 6, 5, 2.4, a, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Pack de dimmer / распределитель : rack avec switches. */
function drawDimmerPack(ctx: CanvasRenderingContext2D) {
  const c = SZ / 2;
  metalBody(ctx, c - 20, c - 16, 40, 34, '#26263a', 4);
  for (let i = 0; i < 4; i++) {
    // Interrupteurs
    ctx.fillStyle = i % 2 ? '#4a4a66' : '#38384e';
    ctx.fillRect(c - 16, c - 12 + i * 8, 22, 5);
    // Voyants
    ctx.fillStyle = i % 2 ? '#66ff88' : '#ffcc44';
    ctx.beginPath(); ctx.arc(c + 13, c - 9.5 + i * 8, 2, 0, Math.PI * 2); ctx.fill();
  }
  // Câbles sortants
  ctx.strokeStyle = '#111118'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(c - 10, c + 18); ctx.lineTo(c - 14, c + 28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c, c + 18); ctx.lineTo(c, c + 28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c + 10, c + 18); ctx.lineTo(c + 14, c + 28); ctx.stroke();
}

// ═══════════════════════════════════════════════════════════════

export function generateAllThumbnails(): ThumbnailVariant[] {
  if (_cache) return _cache;

  const V: ThumbnailVariant[] = [];

  // ── Moving Heads ──
  push(V, 'mh-spot', 'Spot', 'Faisceau concentré motorisé', 'moving_head',
    ctx => drawMovingHead(ctx, '#2a2a3e', '#d0d0ff', 'rgba(31,135,223,0.5)', 0));
  push(V, 'mh-wash', 'Wash', 'Éclairage large motorisé', 'moving_head',
    ctx => drawMovingHead(ctx, '#3a2a3e', '#e8d8ff', 'rgba(180,130,255,0.4)', -12));
  push(V, 'mh-beam', 'Beam', 'Faisceau serré / Beam', 'moving_head',
    ctx => drawMovingHead(ctx, '#1a1a3e', '#f0f0ff', 'rgba(200,200,255,0.6)', 0));
  push(V, 'mh-hybrid', 'Hybrid', 'Spot/Wash/Beam hybride', 'moving_head',
    ctx => drawMovingHead(ctx, '#2a3a3e', '#d8e8ff', 'rgba(100,200,255,0.5)', -5));
  push(V, 'mh-par', 'Moving PAR', 'PAR motorisé 3 axes', 'moving_head',
    ctx => drawMovingHead(ctx, '#3a3a2a', '#ffdd88', 'rgba(255,200,100,0.4)', -20));
  push(V, 'mh-followspot', 'Follow Spot', 'Poursuite sur trépied', 'moving_head',
    ctx => drawFollowSpot(ctx));

  // ── Scanners ──
  push(V, 'scanner-barrel', 'Scanner', 'Scanner à miroir', 'scanner',
    ctx => drawMovingHead(ctx, '#1a2a3e', '#88ccff', 'rgba(100,200,255,0.4)', 5));

  // ── LED PARs ──
  push(V, 'par-can', 'PAR Can 64', 'PAR classique 64', 'led_par',
    ctx => drawPar(ctx, '#2a2a3e', '#383848', false));
  push(V, 'par-flat', 'Flat PAR', 'PAR plat LED', 'led_par',
    ctx => drawPar(ctx, '#1a1a2e', '#203060', true));
  push(V, 'par-rgb', 'PAR RGB', 'PAR LED RGB', 'led_par',
    ctx => drawPar(ctx, '#1a1a2e', '#1a2038', true));
  push(V, 'par-uv', 'PAR UV', 'PAR ultraviolet', 'led_par',
    ctx => drawPar(ctx, '#1a1a1a', '#4a1a88', false));
  push(V, 'par-washer', 'Wall Washer', 'Laveur de mur LED', 'led_par',
    ctx => drawWallWasher(ctx, 6));
  push(V, 'par-fresnel', 'Fresnel', 'Théâtre / Fresnel', 'led_par',
    ctx => drawFresnel(ctx, true));

  // ── LED Bars ──
  push(V, 'led-bar-4', 'Barre LED 4', 'Barre 4 segments', 'led_bar',
    ctx => drawLedBar(ctx, 4, true));
  push(V, 'led-bar-8', 'Barre LED 8', 'Barre 8 segments', 'led_bar',
    ctx => drawLedBar(ctx, 8, true));
  push(V, 'led-bar-h', 'Barre LED Horiz.', 'Barre horizontale', 'led_bar',
    ctx => drawLedBar(ctx, 6, false));
  push(V, 'led-spider', 'Spider Beam', 'Faisceaux multiples serrés', 'led_bar',
    ctx => drawSpider(ctx, 7));

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
  push(V, 'derby', 'Derby FX', 'Balayage multi-faisceaux', 'special',
    ctx => drawDerby(ctx));
  push(V, 'fan', 'Ventilateur', 'Machine à vent / refroidissement', 'special',
    ctx => drawFan(ctx));
  push(V, 'uv-bar', 'Barre UV', 'Barre ultraviolet', 'special',
    ctx => drawLedBar(ctx, 4, true));

  // ── Dimmers / Distribution ──
  push(V, 'dimmer-pack', 'Pack Dimmer', 'Gradateur 4 canaux', 'dimmer',
    ctx => drawDimmerPack(ctx));

  _cache = V;
  return V;
}

// ─── Mapping fixture types → catégories ──────────────────────

const TYPE_TO_CAT: Record<string, string> = {
  'moving head': 'moving_head', 'moving_head': 'moving_head', 'moving yoke': 'moving_head',
  'follow spot': 'moving_head', 'followspot': 'moving_head',
  'scanner': 'scanner',
  'led par': 'led_par', 'led_par': 'led_par', 'par': 'led_par', 'par can': 'led_par',
  'color changer': 'led_par', 'colour changer': 'led_par',
  'wall washer': 'led_par', 'wallwasher': 'led_par', 'fresnel': 'led_par', 'theater': 'led_par',
  'led bar': 'led_bar', 'led_bar': 'led_bar', 'bar': 'led_bar', 'spider': 'led_bar',
  'panel': 'panel', 'matrix': 'panel', 'led panel': 'panel',
  'laser': 'laser',
  'strobe': 'strobe', 'shutter': 'strobe', 'blinder': 'strobe',
  'smoke': 'smoke', 'haze': 'smoke', 'fog': 'smoke', 'hazer': 'smoke',
  'effect': 'special', 'flower': 'special', 'pinspot': 'special',
  'derby': 'special', 'fan': 'special',
  'mirror ball': 'special', 'mirrorball': 'special',
  'dimmer': 'dimmer', 'dimmer pack': 'dimmer', 'régie': 'dimmer',
  'led': 'led_par', // fallback générique
  'other': 'special',
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
