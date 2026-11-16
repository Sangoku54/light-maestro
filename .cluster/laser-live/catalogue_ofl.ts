/**
 * catalogue_ofl.ts — Scan exhaustif des fixtures laser OFL du repo Light Maestro.
 * (subagent 2, plan .cluster/laser-live/plan.md — lecture seule, aucune écriture src/)
 *
 * Méthode :
 *   - scan de resources/fixtures/ofl/** (toutes marques)
 *   - sélection : catégorie OFL brute "laser" OU >=2 canaux référençant "laser"
 *     OU nom du fichier contient "laser" OU cap "Laser off/Off" sur un canal
 *   - pour chaque fixture : parseOFLFixture + mode le plus long + analyse
 *     analyzeFixtureChannels AVEC le fixtureType réel (def.type) — comme le runtime —
 *     et une seconde passe avec fixtureType forcé "Laser" (ce que verrait l'app
 *     si le type n'était pas écrasé par l'ordre des catégories OFL)
 *   - verdicts de risque "éteint" / "blocage" par fixture + comptes a/b/c
 *
 * Usage : npx tsx .cluster/laser-live/catalogue_ofl.ts
 * Livrable : .cluster/laser-live/subagent_02.md (régénéré à chaque run).
 */

import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '../../electron/fixtures/library';
import { analyzeFixtureChannels, isLaserFixture } from '../../src/engine/fixture-analyzer';

const ROOT = process.cwd();
const OFL = path.join(ROOT, 'resources', 'fixtures', 'ofl');
const OUT = path.join(ROOT, '.cluster', 'laser-live', 'subagent_02.md');

const lib = new FixtureLibrary();

/* ── Regex des zones "off" ── */
const RE_LASER = /laser/i;
const RE_SHUTTER_NAME = /shutter|strobe|laser\s*beam|beam\s*shutter/i;
/** Zones explicitement "éteint" (listées dans le task) */
const RE_OFF_STRICT = /closed|laser\s*off|black\s*out|blackout|standby|reset|^off\b|dark|idle|stop|no\s*strobe/i;
/** + NoFunction : "rien" de facto (fermé) pour les canaux shutter */
const RE_OFF_ANY = /closed|laser\s*off|black\s*out|blackout|standby|reset|^off\b|dark|idle|stop|no\s*strobe|no\s*function/i;
const RE_OPEN = /open|^on\b|enable|active/i;
const RE_MODE_NAME = /^(mode(\s*(select|selection))?|show\s*mode|program|show|function|operation)$/i;
const RE_MODE_CONTAINS = /mode/i;
const RE_MODE_ZONE_START = /^(auto|sound|music)/i;
const RE_PATTERN_NAME = /\bpattern\b|\beffect\b/i;
const RE_INTENSITY_NAME = /\bdimmer\b|\bintensity\b|\bbrightness\b/i;
const RE_LASER_OFF_CAP = /laser\s*off/i;
const RE_COLOR_LASER = /(red|green|blue).*laser|laser.*(red|green|blue)/i;
const RE_PROJECTOR_KEYS = /panasonic\/pt-rz120/i;

interface Cap { min: number; max: number; name: string; }
interface ChInfo {
  idx: number;
  offset: number;
  name: string;
  type: string;
  caps: Cap[];
  /** zones "off" strictes */
  offStrict: Cap[];
  /** zones "off" + no function */
  offAny: Cap[];
  shutterLike: boolean;
  modeChannelName: boolean;   // nom = mode/program/show/function/operation
  modeChannelContains: boolean; // nom contient "mode"
  laserOffCap: boolean;
  intensityLike: boolean;
  patternLike: boolean;
}

interface FaInfo {
  isLaser: boolean;
  laserColorMode: string;
  shutterOffset: number | null;
  blankOffset: number | null;
  intensityOffset: number | null;
  laserModeOffset: number | null;
  laserModeCaps: Cap[];
  patternOffset: number | null;
  rgbOffsets: number[] | null;
  wheelOffset: number | null;
}

interface FixtureStat {
  key: string;
  model: string;
  rawCategories: string[];
  typeEff: string;        // def.type (ce que l'app voit réellement)
  catLaser: boolean;      // catégorie OFL brute contient "laser"
  laserRefCount: number;
  modeName: string;
  modeLength: number;
  channels: ChInfo[];
  fa: FaInfo;
  faL: FaInfo | null;     // analyse avec fixtureType forcé "Laser"
  verdicts: string[];
  note: string;
}

/* ── Silence partiel : masquer le debug log de l'analyseur ── */
const origLog = console.log;
const origWarn = console.warn;
(console as any).log = (...a: any[]) => {
  const s = a.map(String).join(' ');
  if (s.includes('[analyzeFixtureChannels]')) return;
  origLog(...a);
};
(console as any).warn = (...a: any[]) => {
  const s = a.map(String).join(' ');
  if (s.includes('OFL switchingChannels')) return;
  origWarn(...a);
};

function parseCaps(raw: any[] | undefined): Cap[] {
  return (raw ?? []).map((c: any) => ({
    min: typeof c.min === 'number' ? c.min : 0,
    max: typeof c.max === 'number' ? c.max : 255,
    name: String(c.name || c.type || ''),
  }));
}

function analyzeCh(ch: any, idx: number): ChInfo {
  const offset = typeof ch.offset === 'number' ? ch.offset : idx;
  const name = String(ch.name ?? '');
  const type = String(ch.type ?? '');
  const caps = parseCaps(ch.capabilities);
  const trimmed = name.trim();
  return {
    idx,
    offset,
    name,
    type,
    caps,
    offStrict: caps.filter((cap) => RE_OFF_STRICT.test(cap.name)),
    offAny: caps.filter((cap) => RE_OFF_ANY.test(cap.name)),
    shutterLike: type === 'Shutter' || type === 'Strobe' || RE_SHUTTER_NAME.test(name),
    modeChannelName: RE_MODE_NAME.test(trimmed) || type === 'Mode',
    modeChannelContains: RE_MODE_CONTAINS.test(trimmed),
    laserOffCap: caps.some((cap) => RE_LASER_OFF_CAP.test(cap.name)),
    intensityLike: type === 'Intensity' || RE_INTENSITY_NAME.test(name),
    patternLike: RE_PATTERN_NAME.test(name),
  };
}

function modeName(mode: any, idx: number): string {
  return String(mode?.name ?? mode?.shortName ?? `mode-${idx}`);
}

function buildPf(file: string, mfr: string, def: any, mo: any, modeIdxName: string, fixtureType: string) {
  return {
    manufacturer: mfr,
    model: def.name ?? file,
    fixtureType,
    modeIndex: 0,
    modeName: modeIdxName,
    universeId: 'u1',
    startAddress: 1,
    channelCount: mo.channels.length,
    name: file,
    id: file,
    tier: 'primary',
  };
}

function runAnalyzer(pf: any, def: any, mo: any): FaInfo | null {
  try {
    const fa = analyzeFixtureChannels(pf, { ...def, modes: [mo] });
    return {
      isLaser: !!fa?.isLaser,
      laserColorMode: fa?.laserColorMode ?? '?',
      shutterOffset: fa?.shutterOffset ?? null,
      blankOffset: fa?.blankOffset ?? null,
      intensityOffset: fa?.intensityOffset ?? null,
      laserModeOffset: fa?.laserModeOffset ?? null,
      laserModeCaps: fa?.laserModeCaps ?? [],
      patternOffset: fa?.patternOffset ?? null,
      rgbOffsets: fa?.rgbOffsets ?? null,
      wheelOffset: fa?.wheelOffset ?? null,
    };
  } catch {
    return null;
  }
}

function isRouted(ch: ChInfo, fa: FaInfo): boolean {
  return (
    ch.offset === fa.shutterOffset ||
    ch.offset === fa.blankOffset ||
    ch.offset === fa.laserModeOffset ||
    ch.offset === fa.patternOffset ||
    ch.offset === fa.intensityOffset ||
    ch.offset === fa.wheelOffset ||
    (fa.rgbOffsets ?? []).includes(ch.offset)
  );
}

/* ── Verdicts ── */
function verdicts(st: FixtureStat): FixtureStat {
  const v: string[] = [];
  const fa = st.fa;
  const chans = st.channels;

  // F — type écrasé par l'ordre des catégories OFL (bug parseOFLFixture)
  if (st.catLaser && st.typeEff !== 'Laser') {
    v.push(`F: catégorie OFL "laser" mais type effectif "${st.typeEff}" (ordre catégories écrase) → isLaser=${fa.isLaser} dans le runtime${fa.isLaser ? ' (compensé par signature laser canaux/caps)' : `${st.faL?.isLaser ? ' (avec type Laser ⇒ isLaser=true)' : ''}`}`);
  } else if (!st.catLaser && st.laserRefCount >= 1) {
    v.push(`C: fichier non typé Laser mais ${st.laserRefCount} canal(aux) laser`);
  }

  // A1 — canal shutter/strobe avec zone "fermée" en tête (0-X, X<=63) jamais écrit
  const a1 = chans.filter(
    (ch) =>
      ch.shutterLike &&
      ch.offAny.some((cap) => cap.min === 0 && cap.max <= 63) &&
      !isRouted(ch, fa),
  );
  if (a1.length) {
    v.push(`A1: shutter fermé 0-X jamais écrit (${a1.map((c) => `${c.name}@${c.offset}[${c.offAny.filter((z) => z.min === 0 && z.max <= 63).map((z) => z.name)}]`).join(', ')}) → sortie 0 = fermé`);
  }

  // A1c — canal shutter dont le nom référence le laser, SANS caps connues, jamais écrit
  const a1c = chans.filter(
    (ch) =>
      ch.shutterLike &&
      RE_LASER.test(ch.name) &&
      ch.caps.length === 0 &&
      !isRouted(ch, fa),
  );
  if (a1c.length) {
    v.push(`A1c: ${a1c.map((c) => `${c.name}@${c.offset}`).join(', ')} (type ${a1c[0].type}, caps absentes) jamais écrit → valeur 0 = fermé probable`);
  }

  // A2 — canal mode avec zone off/laser-off en tête, mode non routé → laser laissé off
  const a2 = chans.filter(
    (ch) =>
      (ch.modeChannelName || ch.modeChannelContains) &&
      ch.offStrict.some((cap) => cap.min === 0) &&
      fa.laserModeOffset === null,
  );
  if (a2.length) {
    v.push(`A2: canal mode à défaut off (${a2.map((c) => `${c.name}@${c.offset}[${c.offStrict.filter((z) => z.min === 0).map((z) => z.name)}]`).join(', ')}) sans laserModeOffset → laser laissé sur off`);
  }

  // A3 — canal (ni shutter ni mode) avec cap off stricte en tête, jamais écrit
  const a3 = chans.filter(
    (ch) =>
      !ch.shutterLike &&
      !ch.modeChannelName &&
      !ch.modeChannelContains &&
      ch.offStrict.some((cap) => cap.min === 0) &&
      !isRouted(ch, fa),
  );
  if (a3.length) {
    v.push(`A3: ${a3.map((c) => `${c.name}@${c.offset}[${c.offStrict.filter((z) => z.min === 0).map((z) => z.name)}]`).join(', ')} jamais écrit → défaut off`);
  }

  // A4 — canal laser couleur (dans rgbOffsets) avec seuil de fermeture en tête
  const a4 = chans.filter(
    (ch) =>
      (fa.rgbOffsets ?? []).includes(ch.offset) &&
      (ch.offStrict.some((cap) => cap.min === 0) || ch.type === 'Shutter' || ch.type === 'Strobe'),
  );
  if (a4.length) {
    v.push(`A4: laser couleur (rgb ${fa.rgbOffsets?.join(',')}) avec seuil fermé en tête (${a4.map((c) => `${c.name}@${c.offset}[${c.offStrict.length ? c.offStrict.filter((z) => z.min === 0).map((z) => `${z.name} ${z.min}-${z.max}`).join(',') : 'type ' + c.type + ' (seuil inconnu)'}]`).join(', ')}) → valeur < seuil = faisceau coupé`);
  }

  // B — canal mode avec zone Auto/Sound en 0-127, mode non routé (filet 128 → son)
  const b = chans.filter(
    (ch) =>
      (ch.modeChannelName || ch.modeChannelContains) &&
      ch.caps.some((cap) => cap.min === 0 && cap.max <= 127 && RE_MODE_ZONE_START.test(cap.name)) &&
      fa.laserModeOffset === null,
  );
  if (b.length) {
    v.push(`B: ${b.map((c) => `${c.name}@${c.offset}[${c.caps.find((z) => z.min === 0)?.name}]`).join(', ')} : zone Auto/Sound 0-127 sans laserModeOffset → filet 128 = mode non-DMX`);
  }

  // D1 — intensité présente mais jamais routée (hors canaux shutter et hors canaux "mode" ex. Dimmer Mode)
  const d1 = chans.filter((ch) => ch.intensityLike && !ch.shutterLike && !ch.modeChannelContains && !isRouted(ch, fa));
  if (d1.length) {
    v.push(`D1: intensité (${d1.map((c) => `${c.name}@${c.offset}`).join(', ')}) non routée → peut rester à 0`);
  }

  // D2 — canal pattern/effect avec zone off début/fin, pattern non routé
  const d2 = chans.filter(
    (ch) => ch.patternLike && ch.offStrict.length > 0 && !isRouted(ch, fa),
  );
  if (d2.length) {
    v.push(`D2: pattern (${d2.map((c) => `${c.name}@${c.offset}[${c.offStrict.map((z) => `${z.name} ${z.min}-${z.max}`).join(',')}]`).join(', ')}) non routé → motif resté sur off`);
  }

  // E — cap "Laser off" sur canal jamais écrit (hors A2/A3 déjà posés)
  if (!v.some((x) => x.startsWith('A2') || x.startsWith('A3'))) {
    const e = chans.filter((ch) => ch.laserOffCap && !isRouted(ch, fa));
    if (e.length) {
      v.push(`E: cap "Laser off" (${e.map((c) => `${c.name}@${c.offset}`).join(', ')}) jamais écrite`);
    }
  }

  st.verdicts = v;
  return st;
}

/* ── Collecte ── */
function collect(): FixtureStat[] {
  const stats: FixtureStat[] = [];
  const mfrDirs = fs.readdirSync(OFL, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const mfr of mfrDirs) {
    const dir = path.join(OFL, mfr);
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    } catch { continue; }
    for (const file of files) {
      const p = path.join(dir, file);
      let json: any = null;
      try { json = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
      if (!json || json.redirectTo) continue;

      let def: any = null;
      try { def = lib.parseOFLFixture(JSON.stringify(json), mfr); } catch { def = null; }
      if (!def || !Array.isArray(def.modes) || def.modes.length === 0) continue;

      const rawCategories: string[] = Array.isArray(json.categories) ? json.categories.map(String) : [];
      const catLaser = rawCategories.some((c) => /laser/i.test(c));
      const typeEff = String(def.type ?? 'Other');

      // mode le plus long
      let longest = 0;
      for (let i = 1; i < def.modes.length; i++) {
        if ((def.modes[i].channels?.length ?? 0) > (def.modes[longest].channels?.length ?? 0)) longest = i;
      }
      const mo = def.modes[longest];
      const channels: ChInfo[] = (mo.channels ?? []).map((ch: any, i: number) => analyzeCh(ch, i));
      const laserRefCount = channels.filter((ch) => RE_LASER.test(ch.name)).length;
      const nameHasLaser = RE_LASER.test(String(json.name ?? ''));
      const hasLaserOffCap = channels.some((ch) => ch.laserOffCap);
      const modeIdxName = modeName(mo, longest);

      const inAttention = catLaser || laserRefCount >= 2 || nameHasLaser || hasLaserOffCap;
      if (!inAttention) continue;

      const pfReal = buildPf(file, mfr, def, mo, modeIdxName, typeEff);
      const fa = runAnalyzer(pfReal as any, def, mo);
      let faL: FaInfo | null = null;
      if (catLaser && typeEff !== 'Laser') {
        const pfL = buildPf(file, mfr, def, mo, modeIdxName, 'Laser');
        faL = runAnalyzer(pfL as any, def, mo);
      }

      const chNames5 = channels.slice(0, 5).map((c) => c.name).filter((n) => RE_LASER.test(n)).join(',');
      const st: FixtureStat = {
        key: `${mfr}/${file}`,
        model: String(json.name ?? def.name ?? 'Unknown'),
        rawCategories,
        typeEff,
        catLaser,
        laserRefCount,
        modeName: modeIdxName,
        modeLength: channels.length,
        channels,
        fa: fa ?? {
          isLaser: false, laserColorMode: '?', shutterOffset: null, blankOffset: null,
          intensityOffset: null, laserModeOffset: null, laserModeCaps: [], patternOffset: null,
          rgbOffsets: null, wheelOffset: null,
        },
        faL,
        verdicts: [],
        note: (RE_PROJECTOR_KEYS.test(stRawKey(`${mfr}/${file}`)) ? 'projecteur vidéo (catégorie Laser OFL = lampe laser, pas laser FX)' : '') + (chNames5 ? `canaux laser: ${chNames5}` : ''),
      };
      stats.push(st);
    }
  }
  return stats;
}

function stRawKey(k: string): string { return k; }

/* ── Formatage ── */
function capShort(cap: Cap): string { return `${cap.name} ${cap.min}-${cap.max}`; }
function fmtCaps(caps: Cap[], max = 5): string {
  if (!caps.length) return '∅';
  const list = caps.slice(0, max).map(capShort);
  return list.join(' | ') + (caps.length > max ? ` …(+${caps.length - max})` : '');
}
function fmtChan(list: ChInfo[], showOff = false): string {
  if (!list.length) return '∅';
  return list.map((c) => {
    const off = showOff ? c.offStrict : [];
    return `${c.name}@${c.offset}${off.length ? '[' + fmtCaps(off, 3) + ']' : ''}`;
  }).join(', ');
}
function faCell(fa: FaInfo): string {
  return `isLaser:${fa.isLaser} shut:${fa.shutterOffset ?? '∅'} blank:${fa.blankOffset ?? '∅'} int:${fa.intensityOffset ?? '∅'} mode:${fa.laserModeOffset ?? '∅'} pat:${fa.patternOffset ?? '∅'} rgb:${fa.rgbOffsets ? '[' + fa.rgbOffsets.join(',') + ']' : '∅'} wheel:${fa.wheelOffset ?? '∅'}`;
}

function tableCells(st: FixtureStat): string[] {
  const shut = st.channels.filter((c) => c.shutterLike);
  const offy = st.channels.filter((c) => c.offStrict.length > 0);
  const modes = st.channels.filter((c) => c.modeChannelName || c.modeChannelContains);
  const ints = st.channels.filter((c) => c.intensityLike);
  const pats = st.channels.filter((c) => c.patternLike);
  const modeCell = modes.length
    ? modes.map((c) => `${c.name}@${c.offset} ⇒ ${fmtCaps(c.caps, 5)}`).join(' ; ')
    : '∅';
  const patCell = pats.length
    ? pats.map((c) => `${c.name}@${c.offset}${c.offStrict.length ? ' (off:' + c.offStrict.map(capShort).join(',') + ')' : ''}`).join(', ')
    : '∅';
  const fix = st.verdicts.length ? st.verdicts.map((vv) => `- ${vv}`).join('<br>') : 'OK (aucun risque)';
  const faL = st.faL ? ` | si type=Laser ⇒ ${faCell(st.faL)}` : '';
  return [
    `**${st.model}**<br>\`${st.key}\``,
    `cat:[${st.rawCategories.join(', ')}]<br>typeEff:${st.typeEff}${st.catLaser && st.typeEff !== 'Laser' ? ' ⚠écrasé' : ''} refLaser:${st.laserRefCount}`,
    `${st.modeName} (${st.modeLength}ch)`,
    fmtChan(shut),
    fmtChan(offy, true),
    modeCell,
    fmtChan(ints),
    patCell,
    faCell(st.fa) + faL,
  ];
}

/* ── Main ── */
function main() {
  const stats: FixtureStat[] = collect().map(verdicts);
  const lasers = stats.filter((s) => s.catLaser || s.laserRefCount >= 2);
  const others = stats.filter((s) => !(s.catLaser || s.laserRefCount >= 2));

  const a1 = lasers.filter((s) => s.verdicts.some((x) => x.startsWith('A1')));
  const a2 = lasers.filter((s) => s.verdicts.some((x) => x.startsWith('A2')));
  const a3 = lasers.filter((s) => s.verdicts.some((x) => x.startsWith('A3')));
  const a4 = lasers.filter((s) => s.verdicts.some((x) => x.startsWith('A4')));
  const a = [...new Set([...a1, ...a2, ...a3, ...a4])];
  const b = lasers.filter((s) => s.verdicts.some((x) => x.startsWith('B')));
  const c = stats.filter((s) => s.typeEff !== 'Laser');
  const f = stats.filter((s) => s.verdicts.some((x) => x.startsWith('F')));

  const score = (s: FixtureStat) =>
    s.verdicts.filter((x) => /^A/.test(x)).length * 100
    + (s.verdicts.some((x) => /^B/.test(x)) ? 50 : 0)
    + s.verdicts.filter((x) => /^D/.test(x)).length * 10
    + (s.verdicts.some((x) => /^E/.test(x)) ? 5 : 0);
  const worst = [...lasers].sort((x, y) => score(y) - score(x));

  /* Markdown */
  const header = [
    '# subagent_02.md — Catalogue des lasers OFL (risques « éteint » / « blocage »)',
    '',
    `Généré le ${new Date().toISOString()} par \`.cluster/laser-live/catalogue_ofl.ts\` (lecture seule, aucune écriture src/).`,
    `Base : \`resources/fixtures/ofl/**\`. Sélection : catégorie OFL brute "laser" OU ≥2 canaux référençant "laser" OU nom/cap laser.`,
    `L'analyse « réel » utilise le \`fixtureType\` effectif (\`def.type\`, cf. DesignView:4398) ; la mention « si type=Laser » = analyse avec type forcé « Laser » (ce que le probe2 faisait).`,
    '',
    `**Total : ${lasers.length} lasers + ${others.length} fichiers annexes.**`,
    '',
  ];

  const tableHead = [
    '| Fixture | Catégories OFL / type effectif | Mode (le + long) | Canaux shutter/faisceau | Canaux off/blackout/Laser off | Canal mode (caps) | Intensité | Pattern (zones off) | Analyseur (réel / si type Laser) | Verdict |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];

  const rows = [...lasers, ...others].sort((x, y) => x.key.localeCompare(y.key)).map((st) => {
    const c = tableCells(st).map((x) => x.replace(/\|/g, '\\|'));
    return `| ${c.join(' | ')} | ${st.verdicts.map((vv) => '- ' + vv).join('<br>')} |`;
  });

  const counts = [
    '## Comptes (a / b / c)',
    '',
    `**(a)** Lasers avec zone « 0-X fermé » (shutter) OU « Laser off » (canal mode/off) existante MAIS \`shutterOffset\`/\`blankOffset\`==null (ou canal jamais écrit) → risque « ne fait rien » : **${a.length}**`,
    `   - A1 (shutter fermé 0-X jamais écrit) : ${a1.length} — ${a1.map((s) => s.key).join(', ') || '—'}`,
    `   - A2 (canal mode à défaut off, mode non routé) : ${a2.length} — ${a2.map((s) => s.key).join(', ') || '—'}`,
    `   - A3 (canal off/blackout/standby jamais écrit) : ${a3.length} — ${a3.map((s) => s.key).join(', ') || '—'}`,
    `   - A4 (laser couleur avec seuil de fermeture en tête, non géré) : ${a4.length} — ${a4.map((s) => s.key).join(', ') || '—'}`,
    '',
    `**(b)** Lasers avec \`laserModeOffset==null\` MAIS canal mode zone « Auto »/« Sound » en 0-127 (filet à 128 → mode son) : **${b.length}** — ${b.map((s) => s.key).join(', ') || 'aucun cas sur ce parc (les canaux mode commencent par Laser off/NoFunction, pas Auto/Sound)'}`,
    '',
    `**(c)** Fichiers au seuil dont le **type effectif n'est pas « Laser »** (parseOFLFixture a écrasé la catégorie Laser par une autre, la plupart « Color Changer ») mais comportant ces canaux laser : **${c.length}**`,
    `   - ${c.map((s) => s.key).join(', ') || '—'}`,
    `   → dont le runtime voit \`isLaser=false\` (ni type ni signature laser dans le mode le + long) : **${c.filter((s) => !s.fa.isLaser).length}** — ${c.filter((s) => !s.fa.isLaser).map((s) => s.key).join(', ') || '—'}`,
    '',
    `**F (systémique)** : catégorie OFL brute contient "laser" mais \`def.type\` ≠ Laser (bug d'écrasement dans parseOFLFixture, écrase par la dernière catégorie) : **${f.length}/${lasers.length}** des lasers du parc`,
    '',
  ];

  const worstList = [
    '## Pires cas (triés par score : A ≫ B ≫ D ≫ E)',
    '',
    ...worst.map((s, i) => {
      const sc = score(s);
      return `${i + 1}. **${s.model}** (\`${s.key}\`) — score ${sc}${s.verdicts.length ? ' :\n   ' + s.verdicts.map((vv) => `- ${vv}`).join('\n   ') : ''}`;
    }),
    '',
    '> Note : `pt-rz120`/`pt-rz120l` (Panasonic) sont des projecteurs vidéo — la catégorie OFL « Laser » désigne la lampe, pas un laser FX.',
    '',
  ];

  const md = [...header, ...tableHead, ...rows, '', ...counts, ...worstList].join('\n');
  fs.writeFileSync(OUT, md, 'utf8');

  /* Console — 10 lignes max */
  const out: string[] = [];
  out.push(`CATALOGUE OFL : ${lasers.length} lasers + ${others.length} annexes`);
  out.push(`(a) zone fermée/Laser-off sans shutter/blankOffset : ${a.length} — ${a.slice(0, 5).map((s) => s.key).join(', ')}${a.length > 5 ? '…' : ''}`);
  out.push(`(b) mode Auto/Sound 0-127 sans laserModeOffset : ${b.length}`);
  out.push(`(c) type effectif non-Laser à canaux laser : ${c.length} (runtime isLaser=false : ${c.filter((s) => !s.fa.isLaser).length})`);
  out.push(`F  type "Laser" écrasé par parseOFLFixture : ${f.length}/${lasers.length} — ex. ${f.slice(0, 3).map((s) => s.key).join(', ')}${f.length > 3 ? '…' : ''}`);
  for (const s of worst.slice(0, 4)) {
    out.push(`  ⚠ ${s.key} : ${s.verdicts.map((v) => v.slice(0, 88)).join(' | ')}`);
  }
  out.push(`Livrable : ${path.relative(ROOT, OUT)}`);
  for (const line of out.slice(0, 10)) console.log(line);
}

main();