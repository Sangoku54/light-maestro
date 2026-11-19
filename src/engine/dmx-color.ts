// ─── DMX Color Utilities ──────────────────────────────────
// Extracted from dmx-playback.ts - pure color math functions
// No React/hook dependencies.

export interface RgbSegment {
  r: number; g: number;
  /** Bleu — null pour les lasers RG (Rouge+Vert sans bleu) : le canal n'existe pas. */
  b: number | null;
  w: number | null;
  /** Amber (RGBA / RGBAW) - offset DMX, null si absent. */
  a?: number | null;
  /** UV (RGBAUUV) - offset DMX, null si absent. */
  uv?: number | null;
  /** LSB 16 bits (canal « … fine ») apparié au canal coarse. */
  rFine?: number | null;
  gFine?: number | null;
  bFine?: number | null;
  wFine?: number | null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
}

/** Hue shift: rotate color on HSL wheel. Preserves brightness. */
export function applyHueShift([r,g,b]: [number,number,number], deg: number): [number,number,number] {
  if (deg === 0) return [r,g,b];
  const nr=r/255,ng=g/255,nb=b/255;
  const mx=Math.max(nr,ng,nb),mn=Math.min(nr,ng,nb);
  const l=(mx+mn)/2;
  if (mx===mn) return [r,g,b];
  const d=mx-mn;
  const s=l>0.5?d/(2-mx-mn):d/(mx+mn);
  let h:number;
  if (mx===nr) h=((ng-nb)/d+(ng<nb?6:0))*60;
  else if (mx===ng) h=((nb-nr)/d+2)*60;
  else h=((nr-ng)/d+4)*60;
  h=(h+deg)%360;if(h<0) h+=360;
  const c=(1-Math.abs(2*l-1))*s;
  const x=c*(1-Math.abs((h/60)%2-1));
  const m=l-c/2;
  let r2,g2,b2:number;
  if(h<60){r2=c;g2=x;b2=0;}else if(h<120){r2=x;g2=c;b2=0;}
  else if(h<180){r2=0;g2=c;b2=x;}else if(h<240){r2=0;g2=x;b2=c;}
  else if(h<300){r2=x;g2=0;b2=c;}else{r2=c;g2=0;b2=x;}
  return [Math.round((r2+m)*255),Math.round((g2+m)*255),Math.round((b2+m)*255)];
}

export const TIER_HUE = { primary: 0, secondary: 120, tertiary: 240, other: 0 } as const;

export function colorDistance(hex1: string, hex2: string): number {
  const [r1,g1,b1]=hexToRgb(hex1); const [r2,g2,b2]=hexToRgb(hex2);
  return Math.sqrt(2*(r1-r2)**2 + 4*(g1-g2)**2 + 3*(b1-b2)**2);
}

export function classifyColor(r: number, g: number, b: number): string {
  if(r>200&&g>200&&b>200)return'white'; if(r<50&&g<50&&b<50)return'black';
  const max=Math.max(r,g,b);
  if(max===r){if(g>b*1.5)return'yellow';if(b>g*1.5)return'magenta';if(r>g*2&&r>b*2)return'red';return'orange';}
  if(max===g){if(r>b*1.5)return'yellow';return'green';}
  if(max===b){if(r>g*1.5)return'magenta';if(r>g*.6)return'purple';return'blue';}
  return'white';
}

export function matchCapToCategory(capName: string, category: string): number {
  if(!capName)return 0; const n=capName.trim();
  const kw: Record<string,string[]>={red:['Red','Rouge','Dark Red','Light Red','Deep Red','Red (1)','Red (2)'],blue:['Blue','Bleu','Cyan','Dark Blue','Light Blue','Sky Blue','Blue (1)','Blue (2)'],green:['Green','Vert','Lime','Dark Green','Light Green','Green (1)','Green (2)'],yellow:['Yellow','Jaune','Amber','Ambre','Gold','Yellow (1)','Yellow (2)'],white:['White','Blanc','Open','Warm White','Cold White','Neutral White','Bright','White (1)','White (2)'],magenta:['Magenta','Pink','Rose','Fuchsia','Magenta (1)','Magenta (2)','Pink (1)','Pink (2)'],cyan:['Cyan','Turquoise','Teal','Aqua','Cyan (1)','Cyan (2)'],orange:['Orange','Orange (1)','Orange (2)'],purple:['Purple','Violet','Pourpre','UV','Lavender','Mauve','Indigo','Purple (1)','Purple (2)','UV (1)'],pink:['Pink','Rose','Salmon','Pink (1)','Pink (2)'],amber:['Amber','Ambre','Gold','Amber (1)','Amber (2)']};
  const k=kw[category]||[category]; const low=n.toLowerCase();
  for(const kk of k){const kl=kk.toLowerCase();if(low===kl)return 10;if(low.startsWith(kl+' '))return 9;if(low.startsWith(kl+'('))return 9;if(low.includes(kl))return 5;}
  return 0;
}

/**
 * Bande d'intensité d'un niveau, normalisée 0..1.
 *
 * Source UNIQUE partagée par `mapIntensity` (rejeu) et par l'enveloppe
 * continue du dimmer (autoscript-envelopes) : les deux doivent agreeing
 * sur la plage de chaque niveau, sinon le dimmer vivant et le dimmer
 * figé ne se rejoignent jamais.
 */
export function intensityBand(level: string): [number, number] {
  switch (level) {
    case 'very-low': return [40 / 255, 130 / 255];
    case 'low': return [100 / 255, 200 / 255];
    case 'medium': return [140 / 255, 240 / 255];
    case 'high': return [180 / 255, 255 / 255];
    case 'very-high': return [200 / 255, 255 / 255];
    default: return [120 / 255, 220 / 255];
  }
}

/**
 * Multiplicateur de tier appliqué au niveau final.
 * Exporté pour que l'enveloppe continue du dimmer applique exactement la
 * même pondération que le chemin historique.
 */
export function tierIntensityMultiplier(
  tier: string,
  tierMults?: { primary: number; secondary: number; tertiary: number },
): number {
  if (tierMults) {
    // Le Tier Mix utilisateur exprime directement le niveau final : 70% = 0.70.
    // L'ancien code sur-multipliait par la base structurelle (0.7 × 0.7 = 0.49
    // pour le secondaire) — faisceaux invisibles malgré un Tier Mix à 70%.
    if (tier === 'primary' || tier === 'other') return tierMults.primary / 100;
    if (tier === 'secondary') return tierMults.secondary / 100;
    return tierMults.tertiary / 100;
  }
  return tier === 'primary' || tier === 'other' ? 1.0 : tier === 'secondary' ? 0.7 : 0.4;
}

export function mapIntensity(level: string, energy: number, tier: string, tierMults?: { primary: number; secondary: number; tertiary: number }): number {
  const ABSOLUTE_MIN=0; let val: number;
  if(level==='dynamic'){val=Math.round(Math.max(ABSOLUTE_MIN,20+energy*235));}
  else{
    const [lo,hi]=intensityBand(level);
    const loD=lo*255, hiD=hi*255;
    val=Math.round(Math.max(ABSOLUTE_MIN,loD+Math.max(0,Math.min(1,energy))*(hiD-loD)));
  }
  const tierMult = tierIntensityMultiplier(tier, tierMults);
  return Math.round(val*tierMult);
}

// ── Channel name patterns ───────────────────────────

export const startsWithRgb=/^(red|green|blue|r|g|b|rouge|vert|bleu|rojo|verde|azul)(\s*\(?\d*\)?)?$/i;
export const hasColorWord=/\b(red|green|blue|white|amber|uv|laser|rouge|vert|bleu|blanc|ambre|rojo|verde|azul|blanco)\b/i;
export const isRed=/\b(red|r|rouge|rojo)\b/i;
export const isGreen=/\b(green|g|vert|verde)\b/i;
export const isBlue=/\b(blue|b|bleu|azul)\b/i;
export const isWhite=/\b(white|w|blanc|blanco)\b/i;
export const isAmber=/\b(amber|ambre|a|naranja)\b/i;
export const isUv=/\b(uv|ultraviolet|ultra\s*violet)\b/i;
export const isPresetMode=/presets?|macro|auto|sound/i;

// ── RGB segment builder ─────────────────────────────

/** Couleurs nommées → hex (roues de couleur dont les caps n'ont pas de champ color). */
export const NAMED_CAP_COLOR_HEX: Record<string, string> = {
  red: '#ff0000', green: '#00ff00', blue: '#0000ff', white: '#ffffff',
  yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', orange: '#ff8800',
  purple: '#8800ff', violet: '#8800ff', amber: '#ffbf00', pink: '#ff69b4',
  uv: '#8800ff', lime: '#00ff44',
};

/** Hex d'une couleur si le nom de cap en contient une, sinon null. */
export function capColorFromName(name: string | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  for (const key of Object.keys(NAMED_CAP_COLOR_HEX)) {
    if (new RegExp(`\\b${key}\\b`).test(n)) return NAMED_CAP_COLOR_HEX[key];
  }
  return null;
}

/**
 * Remplit cap.color depuis le nom quand absent (roues nommées « Yellow »,
 * « Deep Blue »… sans champ color dans le fichier fixture) — sans cela, une
 * roue nommée non colorisée tombait sur un fallback arbitraire (jaune).
 */
export function enrichWheelCaps(caps: DmxFixtureCapability[] | null | undefined): DmxFixtureCapability[] {
  if (!caps || caps.length === 0) return [];
  let changed = false;
  const out = caps.map((cap) => {
    if (cap.color) return cap;
    const hex = capColorFromName(cap.name);
    if (!hex) return cap;
    changed = true;
    return { ...cap, color: hex };
  });
  return changed ? out : caps;
}

/**
 * Mots-couleur explicites (multi-lettres) → clé de canal.
 */
const COLOR_KEYS: Record<string, 'r' | 'g' | 'b' | 'w' | 'a' | 'uv'> = {
  red: 'r', green: 'g', blue: 'b', white: 'w', amber: 'a', uv: 'uv',
  rouge: 'r', vert: 'g', bleu: 'b', blanc: 'w', ambre: 'a',
  rojo: 'r', verde: 'g', azul: 'b', blanco: 'w',
};

/**
 * Mot-couleur STRICT d'un nom de canal.
 *
 * Règle : on retient le DERNIER mot couleur explicite (« B EYE RED » → RED,
 * « Bee eye blue » → BLUE). Les mots d'UNE lettre (R/G/B/W/A) ne comptent
 * que si le nom est réduit à ce seul mot (« R », « R1 ») — sinon « B EYE RED »
 * était détecté comme du BLEU (le « B » isolé matchait /\bblue|b\b/) et le
 * canal bleu réel n'était jamais piloté, tandis que le canal rouge recevait
 * aussi la valeur de bleu.
 */
export function colorKeyOf(name: string): 'r' | 'g' | 'b' | 'w' | 'a' | 'uv' | null {
  // Les noms « camelCase » sont découpés : « uRed » → [u, red] → RED.
  // Sans ce découpage, « uRed » était un mot inconnu (« ured ») et le
  // canal ultra-rouge d'une fixture RGB+ n'était jamais piloté.
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const tokens = spaced.toLowerCase().match(/[a-z]+/g) ?? [];
  if (tokens.length === 0) return null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const k = COLOR_KEYS[tokens[i]];
    if (k) return k;
  }
  if (tokens.length === 1) {
    const t = tokens[0];
    if (t === 'r') return 'r';
    if (t === 'g') return 'g';
    if (t === 'b') return 'b';
    if (t === 'w') return 'w';
    if (t === 'a') return 'a';
  }
  return null;
}

/** Un canal « fine » (sous-résolution) n'est jamais le canal principal. */
export function isFineChannelName(name: string): boolean {
  return /\bfine\b/i.test(name);
}

/** Nom de canal couleur « simple » : « Blue », « Blue 1 », « Red 2 »…
 *  C'est le format des canaux couleur d'un pixel (« Blue 1 » du 1ᵉʳ
 *  pixel). Un nom plus bavard (« Intensity of the blue LED background
 *  illumination ») désigne autre chose qu'un canal couleur de pixel. */
const SIMPLE_COLOUR_NAME_RE = /^\s*(red|green|blue|white|amber|uv)\s*\d*\s*$/i;

/**
 * v3 : regroupe les canaux couleur par FAMILLE de nom (le nom sans son mot
 * couleur) puis en extrait un segment par PIXEL.
 *
 * Trois défauts corrigés par rapport à v2 :
 *
 * 1. Un canal « fine » ne peut PLUS créer un segment à lui seul. En v2, une
 *    famille contenant Red/Green/Blue/White + Red fine/Green fine/Blue fine
 *    (7 canaux) déclenchait le regroupement « > 6 canaux » qui construisait un
 *    segment PARADOXAL { r: « Red fine », g: « Green fine », b: « Blue fine » } :
 *    le moteur écrivait alors la couleur sur les octets de SUB-RÉSOLUTION.
 *    Les fines sont désormais APPARIÉS à leur coarse (octet LSB).
 *
 * 2. Une famille qui contient N fois Rouge, N fois Vert, N fois Bleu
 *    (barre à pixels dont les canaux portent le MÊME nom : « Red Pixel null »
 *    répété 30 fois) ne produit plus qu'UN segment : elle en produit N.
 *    Sans ça, 29 pixels sur 30 restaient muets.
 *
 * 3. Le blanc est accepté même sans bleu (fixtures RGW), et l'achromatique
 *    est calculé sans le bleu (splitRgbw a un paramètre dedicated).
 */
export function buildRgbSegments(colourChannels: Array<{offset:number;name:string}>): RgbSegment[] {
  // Famille = nom SANS les mots couleur (et sans les mots d'une lettre
  // isolés) : « Red1 » → « 1 », « B EYE RED » → « eye », « Red » → « ».
  const familyOf = (name: string): string => {
    // Lettres et chiffres séparés : « Red1 » → [red, 1] (sinon « red1 » et
    // « green1 » seraient deux familles différentes → aucun segment).
    // Les noms « camelCase » sont aussi découpés : « uRed » → [u, red]
    // (sinon « ured » formait une famille à lui seul et le jeu uRed/uGreen/
    // uBlue n'était jamais exploité).
    const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    const tokens = (spaced.toLowerCase().match(/[a-z]+|\d+/g) ?? []);
    const kept = tokens.filter((t) => !(t in COLOR_KEYS)
      && !/^(r|g|b|w|a)$/.test(t)
      && t !== 'fine');
    return kept.join(' ');
  };

  const families = new Map<string, number[]>();
  for (let j = 0; j < colourChannels.length; j++) {
    const fam = familyOf(colourChannels[j].name);
    const list = families.get(fam) ?? [];
    list.push(j);
    families.set(fam, list);
  }

  const segments: RgbSegment[] = [];
  /** Indices des canaux déjà absorbés par un segment. */
  const usedIdx = new Set<number>();

  for (const fam of families.values()) {
    // 1) Séparation coarse / fine, indexation par mot-couleur.
    const coarseByKey = new Map<string, number[]>();
    const fineByKey = new Map<string, number[]>();
    for (const j of fam) {
      const key = colorKeyOf(colourChannels[j].name);
      if (!key) continue;
      const target = isFineChannelName(colourChannels[j].name) ? fineByKey : coarseByKey;
      const list = target.get(key) ?? [];
      list.push(j);
      target.set(key, list);
    }
    const byOffset = (a: number, b: number) => colourChannels[a].offset - colourChannels[b].offset;
    const rs = (coarseByKey.get('r') ?? []).sort(byOffset);
    const gs = (coarseByKey.get('g') ?? []).sort(byOffset);
    const bs = (coarseByKey.get('b') ?? []).sort(byOffset);
    const ws = (coarseByKey.get('w') ?? []).sort(byOffset);
    const as = (coarseByKey.get('a') ?? []).sort(byOffset);
    const uvs = (coarseByKey.get('uv') ?? []).sort(byOffset);

    if (rs.length === 0 || gs.length === 0) continue;
    // Un segment exige un triplet complet (R+G+B) ; sans bleu on accepte le
    // couple R+G (lasers RG) et on laisse le blanc de côté s'il n'y a pas de
    // base RGB complète... non : le blanc est utile même en RGW.
    const hasBlue = bs.length > 0;
    const count = hasBlue
      ? Math.min(rs.length, gs.length, bs.length)
      : Math.min(rs.length, gs.length);
    if (count === 0) continue;

    // 2) Appariement fine ↔ coarse : le fine appartient au coarse qui le
    //    précède le plus immédiatement (convention DMX 16 bits).
    const pairFine = (coarseIdx: number[], fineIdx: number[]): Map<number, number> => {
      const map = new Map<number, number>();
      for (const f of fineIdx) {
        let best = -1;
        for (const c of coarseIdx) {
          if (colourChannels[c].offset < colourChannels[f].offset) best = c;
          else break;
        }
        if (best >= 0 && !map.has(best)) map.set(best, f);
      }
      return map;
    };
    const rFineMap = pairFine(rs, (fineByKey.get('r') ?? []).sort(byOffset));
    const gFineMap = pairFine(gs, (fineByKey.get('g') ?? []).sort(byOffset));
    const bFineMap = pairFine(bs, (fineByKey.get('b') ?? []).sort(byOffset));
    const wFineMap = pairFine(ws, (fineByKey.get('w') ?? []).sort(byOffset));

    // 3) Un segment par pixel : le kᵉ rouge, le kᵉ vert, le kᵉ bleu…
    for (let k = 0; k < count; k++) {
      const ri = rs[k], gi = gs[k];
      const bi = hasBlue ? bs[k] : -1;
      const wi = ws.length > k ? ws[k] : -1;
      const ai = bi >= 0 && as.length > k ? as[k] : -1;
      const uvi = bi >= 0 && uvs.length > k ? uvs[k] : -1;
      usedIdx.add(ri); usedIdx.add(gi);
      if (bi >= 0) usedIdx.add(bi);
      if (wi >= 0) usedIdx.add(wi);
      if (ai >= 0) usedIdx.add(ai);
      if (uvi >= 0) usedIdx.add(uvi);
      for (const m of [rFineMap.get(ri), gFineMap.get(gi), bi >= 0 ? bFineMap.get(bi) : undefined, wi >= 0 ? wFineMap.get(wi) : undefined]) {
        if (m !== undefined) usedIdx.add(m);
      }
      segments.push({
        r: colourChannels[ri].offset,
        g: colourChannels[gi].offset,
        b: bi >= 0 ? colourChannels[bi].offset : null,
        w: wi >= 0 ? colourChannels[wi].offset : null,
        a: ai >= 0 ? colourChannels[ai].offset : null,
        uv: uvi >= 0 ? colourChannels[uvi].offset : null,
        rFine: rFineMap.has(ri) ? colourChannels[rFineMap.get(ri)!].offset : null,
        gFine: gFineMap.has(gi) ? colourChannels[gFineMap.get(gi)!].offset : null,
        bFine: bi >= 0 && bFineMap.has(bi) ? colourChannels[bFineMap.get(bi)!].offset : null,
        wFine: wi >= 0 && wFineMap.has(wi) ? colourChannels[wFineMap.get(wi)!].offset : null,
      });
    }
  }

  // ── Passe RÉSIDUELLE : triplets par ORDRE DMX ────────────────────
  // Certaines fixtures nomment leurs canaux couleur avec des coordonnées
  // (« Red (0,0) », « Green (0,1) », « Blue (1,0) » — matrice de pixels) :
  // chaque canal forme alors sa propre « famille » et le regroupement par
  // famille ne produit AUCUN segment → la moitié de la matrice reste muette.
  //
  // On rattrape ces canaux par un balayage EN ORDRE DMX : rouge → vert →
  // bleu (le premier bleu qui suit), avec le blanc adjacent si présent.
  // Seuls les canaux encore libres sont concernés (les segments déjà
  // construits gardent la priorité).
  {
    const residual = colourChannels
      .map((c, j) => j)
      .filter((j) => !usedIdx.has(j) && !isFineChannelName(colourChannels[j].name))
      .sort((a, b) => colourChannels[a].offset - colourChannels[b].offset);
    const keyAt = (j: number) => colorKeyOf(colourChannels[j].name);
    let i = 0;
    while (i < residual.length) {
      const riPos = residual.findIndex((j, k) => k >= i && keyAt(j) === 'r');
      if (riPos < 0) break;
      const giPos = residual.findIndex((j, k) => k > riPos && keyAt(j) === 'g');
      if (giPos < 0) { i = riPos + 1; continue; }
      const biPos = residual.findIndex((j, k) => k > giPos && keyAt(j) === 'b');
      if (biPos < 0) { i = riPos + 1; continue; }
      // Blanc ADJACENT (offset juste après le bleu) : même pixel RGBW.
      const wi = residual.find((j, k) =>
        k === biPos + 1 && keyAt(j) === 'w'
        && colourChannels[j].offset === colourChannels[biPos].offset + 1);
      const ri = residual[riPos], gi = residual[giPos], bi = residual[biPos];
      usedIdx.add(ri); usedIdx.add(gi); usedIdx.add(bi);
      if (wi !== undefined) usedIdx.add(wi);
      segments.push({
        r: colourChannels[ri].offset,
        g: colourChannels[gi].offset,
        b: colourChannels[bi].offset,
        w: wi !== undefined ? colourChannels[wi].offset : null,
        a: null,
        uv: null,
        rFine: null, gFine: null, bFine: null, wFine: null,
      });
      i = biPos + 1;
    }
  }

  // ── Remplissage des segments INCOMPLETS ──────────────────────
  // Un segment peut manquer un slot (souvent le bleu) parce que le canal
  // correspondant a été rangé dans une AUTRE famille : « Red 1/Colour
  // Select » + « Green 1/Colour Select » d'un côté (famille « 1 colour
  // select »), « Blue 1 » de l'autre (famille « 1 »). Sans ce remplissage,
  // le bleu du 1ᵉʳ pixel n'était JAMAIS piloté → le pixel n'était qu'un
  // dégradé rouge/vert.
  //
  // On n'accepte qu'un canal au nom couleur SIMPLE (« Blue », « Blue 1 ») :
  // « Intensity of the blue LED background illumination » d'un laser n'est
  // PAS le bleu du faisceau, c'est l'intensité d'un LED de fond.
  {
    const free = colourChannels
      .map((c, j) => j)
      .filter((j) => !usedIdx.has(j) && !isFineChannelName(colourChannels[j].name));
    const SLOTS = ['b', 'w'] as const;
    for (const seg of segments) {
      for (const slot of SLOTS) {
        if (seg[slot] !== null) continue;
        const members = [seg.r, seg.g, seg.b, seg.w].filter((v): v is number => v !== null);
        if (members.length === 0) continue;
        const minOff = Math.min(...members);
        const maxOff = Math.max(...members);
        const cand = free
          .map((j) => ({ j, off: colourChannels[j].offset }))
          .filter((c) => colorKeyOf(colourChannels[c.j].name) === slot)
          .filter((c) => SIMPLE_COLOUR_NAME_RE.test(colourChannels[c.j].name))
          .filter((c) => c.off >= minOff && c.off <= maxOff + 3)
          .sort((a, b) => a.off - b.off)[0];
        if (!cand) continue;
        seg[slot] = colourChannels[cand.j].offset;
        usedIdx.add(cand.j);
        const at = free.indexOf(cand.j);
        if (at >= 0) free.splice(at, 1);
      }
    }
  }

  // Ordre déterministe : par offset minimal du segment.
  segments.sort((a, b) => Math.min(a.r, a.g) - Math.min(b.r, b.g));
  return segments;
}

/**
 * Décomposition RGB → RGBW PRÉSERVANT la couleur.
 *
 * Sur une fixture RGBW, la LED blanche (W) est une resource au même titre
 * que R/G/B : la laisser à 0 revient à piloter 3 canaux sur 4. On extrait
 * la composante achromatique (le MIN de R/G/B) vers W, ce qui rend EXACTEMENT
 * la même couleur (même teinte, même luminance) mais en pilotant les 4 canaux.
 * Le blanc pur (255,255,255) devient W=255, RGB=0 → le vrai blanc de la
 * fixture au lieu d'un blanc « simulé » par 3 LEDs saturées.
 *
 * `hasBlue = false` (fixture RGW / laser RG) : l'achromatique de référence est
 * min(R,G) — le bleu n'existe pas sur le matériel, l'inclure ferait une
 * extraction trop faible (le blanc ne serait jamais atteint).
 */
export function splitRgbw(r: number, g: number, b: number, hasBlue = true): { r: number; g: number; b: number; w: number } {
  const w = hasBlue ? Math.min(r, g, b) : Math.min(r, g);
  if (w <= 0) return { r, g, b, w: 0 };
  return { r: r - w, g: g - w, b: hasBlue ? b - w : b, w };
}

import type { DmxFixtureCapability } from '../hooks/dmx-cues';
import type { PatchedFixture } from '../stores/showStore';

/** Roue dégénérée = toutes ses caps partagent une couleur imposée par le défaut
 *  (ex: « CHOISE COLOR 0-139 #ff0000 » sur une vraie roue arc-en-ciel). Aucune
 *  couleur n'est exprimable via le matching → on DOIT piloter la roue par
 *  POSITION pour que la fixture change réellement de couleur sur la piste. */
export function wheelIsDegenerateForFixture(caps: DmxFixtureCapability[], fa: { isLaser?: boolean }): boolean {
  if (fa.isLaser) return false;
  if (!caps || caps.length === 0) return false;
  const distinct = new Set(caps.map((c) => c.color ?? '').filter(Boolean));
  return distinct.size <= 1;
}

/** Écrit une couleur de roue par POSITION sur la plage manuelle de la roue
 *  (catégorie ≈ teinte de la palette). Retourne la position ou null si cette
 *  roue n'est pas dégénérée (→ laisser le matching par slot s'appliquer). */
export function wheelDegeneratePosition(
  caps: DmxFixtureCapability[],
  fa: { isLaser?: boolean },
  paletteHex: string,
  timeSeconds: number,
): number | null {
  if (!wheelIsDegenerateForFixture(caps, fa)) return null;
  const manual = caps.filter((c) => !/(auto|change|rotat|scroll|jump|dance|soun|spee|dither)/i.test(c.name ?? ''));
  const range = manual.length > 0 ? manual : caps;
  const lo = Math.min(...range.map((c) => c.min));
  const hi = Math.max(...range.map((c) => c.max));
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return hi;
  const [r, g, b] = hexToRgb(paletteHex);
  const cat = classifyColor(r, g, b);
  const catToWheelPos: Record<string, number> = { red: 0.10, orange: 0.20, yellow: 0.30, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02, black: 0.02 };
  const wPos = catToWheelPos[cat] ?? 0.5;
  const sweep = 0.08 * Math.sin(timeSeconds * 1.4); // léger vivaneau temporel
  return Math.round(lo + Math.max(0, Math.min(1, wPos + sweep)) * (hi - lo));
}

export function findBestWheelCap(caps: DmxFixtureCapability[], paletteHex: string): DmxFixtureCapability|null {
  if(caps.length===0)return null;
  const[r,g,b]=hexToRgb(paletteHex);const cat=classifyColor(r,g,b);
  let bestName:{cap:DmxFixtureCapability;score:number}|null=null;
  for(const cap of caps){
    if(!cap.name)continue;
    const s=matchCapToCategory(cap.name,cat);
    if(s>(bestName?.score??0)){
      bestName={cap,score:s};
    } else if(s>0&&bestName&&s===bestName.score){
      // Égalité de score de nom (ex. « CYAN » et « BLUE » matchent tous les
      // deux la catégorie bleu) : départager par distance de couleur réelle
      // pour ne pas retomber sur le premier tour de roue.
      const bestDist=bestName.cap.color?colorDistance(paletteHex,bestName.cap.color):Infinity;
      const curDist=cap.color?colorDistance(paletteHex,cap.color):Infinity;
      if(curDist<bestDist) bestName={cap,score:s};
    }
  }
  if(bestName&&bestName.score>=5)return bestName.cap;
  let bestCap:DmxFixtureCapability|null=null;let bestDist=Infinity;
  for(const cap of caps){if(cap.color){const d=colorDistance(paletteHex,cap.color);if(d<bestDist){bestDist=d;bestCap=cap;}}}
  if(bestCap&&bestDist<350)return bestCap;
  if(bestName&&bestName.score>0)return bestName.cap;
  const catToWheelPos: Record<string, number> = {red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02,black:0.02};
  const wheelPos=catToWheelPos[cat]??0.5;
  return caps[Math.floor(wheelPos*caps.length)%caps.length];
}
