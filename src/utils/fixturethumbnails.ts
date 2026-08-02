/**
 * Fixture Thumbnail Generator
 *
 * Creates realistic 2D icons for each fixture category/variant using Canvas2D.
 * Generated as data URLs and cached so the browser only renders them once.
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
let _generating = false;

// ─── Canvas helpers ──────────────────────────────────────────

function createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function drawMovingHead(ctx: CanvasRenderingContext2D, w: number, h: number, bodyColor: string, lensColor: string, beamColor: string, tilt: number): void {
  const cx = w / 2;
  const cy = h / 2;

  // Base plate
  ctx.fillStyle = '#222233';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 16, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Yoke (arms)
  ctx.strokeStyle = '#3a3a4e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy + 4);
  ctx.lineTo(cx - 8, cy - 4);
  ctx.moveTo(cx + 12, cy + 4);
  ctx.lineTo(cx + 8, cy - 4);
  ctx.stroke();

  // Head body
  ctx.save();
  ctx.translate(cx, cy - 6);
  ctx.rotate(tilt * Math.PI / 180);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-7, -12, 14, 24);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(-7, -12, 14, 24);
  ctx.restore();

  // Lens
  ctx.save();
  ctx.translate(cx, cy - 6);
  ctx.rotate(tilt * Math.PI / 180);
  ctx.fillStyle = lensColor;
  ctx.beginPath();
  ctx.ellipse(0, -12, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Beam glow from lens
  const grad = ctx.createLinearGradient(0, -12, 0, -40);
  grad.addColorStop(0, beamColor);
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-5, -12);
  ctx.lineTo(5, -12);
  ctx.lineTo(2, -40);
  ctx.lineTo(-2, -40);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPar(ctx: CanvasRenderingContext2D, w: number, h: number, bodyColor: string, faceColor: string): void {
  const cx = w / 2;
  const cy = h / 2;

  // Body (parabolic can)
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy + 16);
  ctx.lineTo(cx - 16, cy - 4);
  ctx.quadraticCurveTo(cx - 12, cy - 10, cx, cy - 10);
  ctx.quadraticCurveTo(cx + 12, cy - 10, cx + 16, cy - 4);
  ctx.lineTo(cx + 14, cy + 16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Face
  ctx.fillStyle = faceColor;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 6, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // LED dots
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = `hsl(${i * 60}, 70%, 60%)`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * 4, cy - 6 + Math.sin(angle) * 2, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Yoke bracket
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy + 8);
  ctx.lineTo(cx - 3, cy + 16);
  ctx.moveTo(cx + 3, cy + 8);
  ctx.lineTo(cx + 3, cy + 16);
  ctx.stroke();
}

function drawLaser(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  const cx = w / 2;
  const cy = h / 2;

  // Box
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(cx - 10, cy - 6, 20, 16);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 10, cy - 6, 20, 16);

  // Aperture
  ctx.fillStyle = '#333';
  ctx.fillRect(cx - 4, cy + 10, 8, 3);

  // Laser beams
  const grad = ctx.createLinearGradient(0, cy + 12, 0, cy + 30);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'transparent');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + 12);
    ctx.lineTo(cx + i * 6, cy + 28);
    ctx.stroke();
  }
}

function drawStrobe(ctx: CanvasRenderingContext2D, w: number, h: number, frontColor: string): void {
  const cx = w / 2;
  const cy = h / 2;

  // Body
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(cx - 16, cy - 4, 32, 18);
  ctx.strokeStyle = '#555';
  ctx.strokeRect(cx - 16, cy - 4, 32, 18);

  // Front panel
  ctx.fillStyle = frontColor;
  ctx.fillRect(cx - 14, cy - 2, 10, 14);
  ctx.fillRect(cx + 4, cy - 2, 10, 14);

  // Flash glow
  const grad = ctx.createRadialGradient(cx, cy - 14, 0, cx, cy - 14, 14);
  grad.addColorStop(0, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy - 14, 14, 0, Math.PI * 2);
  ctx.fill();
}

function drawSmoke(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;

  ctx.fillStyle = 'rgba(136,136,153,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx - 6, cy + 4, 10, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + 4, cy, 12, 10, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy - 6, 8, 12, -0.2, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Generate all variants ───────────────────────────────────

export function generateAllThumbnails(): ThumbnailVariant[] {
  if (_cache) return _cache;

  const variants: ThumbnailVariant[] = [];
  const size = 64;

  // ── Moving Heads ──
  const movingHeads: [string, string, string, string, number][] = [
    ['mh-spot', 'Spot', 'Faisceau concentré', '#2a2a3e', 0],
    ['mh-wash', 'Wash', 'Éclairage large', '#3a2a3e', -10],
    ['mh-beam', 'Beam', 'Faisceau très serré', '#1a1a3e', 0],
    ['mh-hybrid', 'Hybrid', 'Spot/Wash hybride', '#2a3a3e', -5],
    ['mh-par', 'Moving PAR', 'PAR motorisé', '#3a3a2a', -15],
  ];
  for (const [id, label, desc, bodyColor, tilt] of movingHeads) {
    const [c, ctx] = createCanvas(size, size);
    drawMovingHead(ctx, size, size, bodyColor, '#cccccc', '#a855f780', tilt);
    variants.push({ id, label, description: desc, dataUrl: c.toDataURL(), category: 'moving_head' });
  }

  // ── LED PARs ──
  const pars: [string, string, string, string, string][] = [
    ['par-can', 'PAR Can', 'Projecteur PAR classique', '#2a2a3e', '#333'],
    ['par-flat', 'Flat PAR', 'PAR plat LED', '#1a1a2e', '#222'],
  ];
  for (const [id, label, desc, bodyColor, faceColor] of pars) {
    const [c, ctx] = createCanvas(size, size);
    drawPar(ctx, size, size, bodyColor, faceColor);
    variants.push({ id, label, description: desc, dataUrl: c.toDataURL(), category: 'led_par' });
  }

  // ── Lasers ──
  const lasers: [string, string, string, string][] = [
    ['laser-single', 'Laser Simple', 'Laser simple couleur', '#ff0000'],
    ['laser-rgb', 'Laser RGB', 'Laser RVB multi-faisceaux', '#00ff00'],
    ['laser-bar', 'Barre Laser', 'Barre de lasers', '#ff00ff'],
  ];
  for (const [id, label, desc, color] of lasers) {
    const [c, ctx] = createCanvas(size, size);
    drawLaser(ctx, size, size, color);
    variants.push({ id, label, description: desc, dataUrl: c.toDataURL(), category: 'laser' });
  }

  // ── Strobes ──
  const strobes: [string, string, string, string][] = [
    ['strobe-single', 'Strobe Simple', 'Stroboscope standard', '#eeeeee'],
    ['strobe-blinder', 'Blinder', 'Blinder 2 lampes', '#ffffcc'],
  ];
  for (const [id, label, desc, frontColor] of strobes) {
    const [c, ctx] = createCanvas(size, size);
    drawStrobe(ctx, size, size, frontColor);
    variants.push({ id, label, description: desc, dataUrl: c.toDataURL(), category: 'strobe' });
  }

  // ── Smoke / Haze ──
  {
    const [c, ctx] = createCanvas(size, size);
    drawSmoke(ctx, size, size);
    variants.push({ id: 'smoke-haze', label: 'Fumée / Haze', description: 'Machine à fumée', dataUrl: c.toDataURL(), category: 'smoke' });
  }

  _cache = variants;
  return variants;
}

/** Get variants filtered by fixture type category */
export function getVariantsForCategory(category: string): ThumbnailVariant[] {
  const all = generateAllThumbnails();

  // Normalize: map fixture types to categories
  const catMap: Record<string, string> = {
    'moving_head': 'moving_head',
    'moving head': 'moving_head',
    'scanner': 'moving_head',
    'led_par': 'led_par',
    'led par': 'led_par',
    'led': 'led_par',
    'laser': 'laser',
    'strobe': 'strobe',
    'smoke': 'smoke',
    'haze': 'smoke',
    'fog': 'smoke',
    'dimmer': 'led_par',
    'color changer': 'led_par',
  };

  const cat = catMap[category.toLowerCase()] || 'led_par';
  return all.filter(v => v.category === cat);
}
