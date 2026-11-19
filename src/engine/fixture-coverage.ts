/**
 * Fixture Coverage — Audit de canal à canal d'une fixture patchée.
 *
 * Règle projet (AGENTS.md) : à chaque patch d'une fixture, chaque canal utile
 * (intensity, pan/tilt, RGB, shutter/strobe, wheel/gobo, macro, laser…) doit
 * être détecté et piloté par le moteur. Ce module réutilise l'analyse moteur
 * (fixture-analyzer) et classe chaque canal :
 *   - written          → l'analyse référence l'offset (le moteur écrira ce canal)
 *   - preset / macro   → exclu volontairement des écritures (sélecteurs user)
 *   - silent-benign    → paramètre secondaire (speed/fine/status…) non écrit,
 *                        sans impact lumière (accepté)
 *   - silent-risk      → canal « parlant » (intensity/couleur/gobo/mouvement…)
 *                        qui ne sera JAMAIS écrit : défaillance de la def ou de
 *                        l'analyse à corriger impérativement.
 */

import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../hooks/dmx-cues';
import type { FixtureChannelAnalysis } from './fixture-analyzer';

/** Type de canal considéré comme paramètre secondaire sans impact lumière :
 *  ne jamais déclencher de warning s'il n'est pas écrit. */
const SILENT_BENIGN_TYPE_RE = /^(Nothing|Speed|Maintenance|Effect)$/;

/** Noms correspondant à des paramètres secondaires (vitesse, fine, statut,
 *  maintenance…) : acceptable de ne pas les écrire. */
const SILENT_BENIGN_NAME_RE =
  /\b(speed|fine|level|status|sensitivity|frequency|duration|density|presets?|macro)\b|^auto[\s-]*|^sound|\b(mode|master|maintenance|reset|menu|calibrat|self[\s-]*test|switch|power)\b/i;

const SILENT_RISK_TYPE_RE =
  /^(Intensity|Colour|Gobo|Shutter|Strobe|Prism|Zoom|Frost|Focus|Iris|Pan|Tilt|Beam)$/;

/** Récupère toutes les offsets que le moteur écrira selon l'analyse (canaux
 *  détectés + segments RGB + offsets laser + canaux à capacités). */
export function collectWrittenOffsets(fa: FixtureChannelAnalysis): Set<number> {
  const offsets = new Set<number>();
  const add = (o: number | null | undefined) => {
    if (o !== null && o !== undefined) offsets.add(o);
  };
  const addAll = (arr: number[] | null | undefined) => (arr || []).forEach(add);

  add(fa.intensityOffset); addAll(fa.ledIntensityOffsets); add(fa.intensityFineOffset);
  add(fa.shutterOffset); add(fa.strobeOffset); add(fa.effectOffset);
  add(fa.wheelOffset); add(fa.goboOffset);
  add(fa.zoomOffset); add(fa.frostOffset); add(fa.irisOffset); add(fa.focusOffset); add(fa.beamOffset);
  add(fa.prismOffset);
  // TOUTES les vitesses (pas seulement la première)
  addAll(fa.speedOffsets);
  addAll(fa.panOffsets); addAll(fa.tiltOffsets);
  // Canaux « fine » 16 bits
  addAll(fa.panFineOffsets); addAll(fa.tiltFineOffsets);
  addAll(fa.rgbOffsets);
  for (const seg of fa.rgbSegments) {
    add(seg.r); add(seg.g); add(seg.b); add(seg.w); add(seg.a); add(seg.uv);
    // Octets LSB 16 bits (canaux « fine » couleur)
    add(seg.rFine); add(seg.gFine); add(seg.bFine); add(seg.wFine);
  }
  // Laser
  add(fa.laserModeOffset); add(fa.laserColorGateOffset); add(fa.laserMasterOffset);
  add(fa.patternOffset); add(fa.scanXOffset); add(fa.scanYOffset);
  add(fa.laserSpeedScanOffset); add(fa.laserSpeedPatternOffset); add(fa.blankOffset);
  addAll(fa.laserRotationOffsets);
  addAll(fa.laserGateOffsets.map(g => g.offset));
  // Mélangeur CMY
  add(fa.cmyOffsets?.c); add(fa.cmyOffsets?.m); add(fa.cmyOffsets?.y);
  // Pixels blancs autonomes + doublons couleur
  addAll(fa.whitePixels);
  for (const c of fa.extraColourChannels) add(c.offset);
  // Canaux nominaux (2e zoom, 2e gobo, rotation, CTO…) + paires fine/coarse
  for (const n of fa.nominalChannels) add(n.offset);
  for (const p of fa.finePairs) add(p.fineOffset);
  // Canaux à capacités sans rôle dédié → état déterministe écrit
  for (const c of fa.capabilityChannels) add(c.offset);
  // Canaux couleur AUXILIAIRES : écrits à 0 (éteints) → ils sont pilotés,
  // pas muets (l'audit doit les compter comme écrits).
  addAll(fa.auxColourChannels);
  return offsets;
}

export interface FixtureCoverageChannel {
  /** Offset relatif dans le mode de la def. */
  offset: number;
  name: string;
  type: string;
  status: 'written' | 'preset' | 'macro' | 'silent-benign' | 'silent-risk';
}

export interface FixtureCoverageReport {
  fixtureName: string;
  fixtureDefId: string;
  channels: FixtureCoverageChannel[];
  /** Canaux parlants que le moteur n'écrira jamais (à corriger def ou analyse). */
  warnings: FixtureCoverageChannel[];
  writtenChannels: number;
  totalChannels: number;
}

function classifyChannel(
  ch: DmxFixtureChannel,
  offset: number,
  written: Set<number>,
  presetOffsets: number[],
  macroOffsets: number[],
): FixtureCoverageChannel['status'] {
  if (written.has(offset)) return 'written';
  if (presetOffsets.includes(offset)) return 'preset';
  if (macroOffsets.includes(offset)) return 'macro';
  const name = ch.name ?? '';
  const type = String(ch.type ?? '');
  if (SILENT_BENIGN_TYPE_RE.test(type) || SILENT_BENIGN_NAME_RE.test(name)) return 'silent-benign';
  if (SILENT_RISK_TYPE_RE.test(type)) return 'silent-risk';
  // Type inconnu restant mais jamais écrit : ni paramètre ni fonction connue.
  return 'silent-risk';
}

/** Analyse complète de la couverture d'une fixture patchée. */
export function auditFixtureCoverage(
  pf: PatchedFixture,
  def: DmxFixtureDefinition | undefined,
  fa?: FixtureChannelAnalysis,
): FixtureCoverageReport {
  const channels = def?.modes?.[pf.modeIndex ?? 0]?.channels ?? [];
  const written = collectWrittenOffsets(fa);
  const presetOffsets = fa?.presetOverrideOffsets ?? [];
  const macroOffsets = fa?.macroOffsets ?? [];

  const report: FixtureCoverageChannel[] = channels.map((ch, idx) => {
    // L'offset réel d'un canal de bibliothèque est son INDEX dans le mode
    // (les parseurs n'exposent pas de numéro DMX) : `ch.offset ?? 0` traitait
    // tous les canaux comme étant l'offset 0 → l'audit était faux.
    const offset = ch.offset ?? idx;
    const status = classifyChannel(ch, offset, written, presetOffsets, macroOffsets);
    return {
      offset,
      name: ch.name ?? '',
      type: String(ch.type ?? ''),
      status,
    };
  });

  const warnings = report.filter((c) => c.status === 'silent-risk');
  return {
    fixtureName: pf.name,
    fixtureDefId: pf.fixtureDefId,
    channels: report,
    warnings,
    writtenChannels: report.filter((c) => c.status === 'written').length,
    totalChannels: channels.length,
  };
}

/** Couverture d'un ensemble de fixtures patchées (résolus via le résolveur fourni). */
export function auditPatchedCoverage(
  patched: PatchedFixture[],
  resolveDef: (id: string) => DmxFixtureDefinition | undefined,
  analyze: (pf: PatchedFixture, def: DmxFixtureDefinition | undefined) => FixtureChannelAnalysis,
): FixtureCoverageReport[] {
  return patched.map((pf) => {
    const def = resolveDef(pf.fixtureDefId);
    let fa: FixtureChannelAnalysis | undefined;
    try { fa = def ? analyze(pf, def) : undefined; } catch { fa = undefined; }
    return auditFixtureCoverage(pf, def, fa);
  });
}

/** Message console lisible pour un warning de couverture (câblage « au patch »). */
export function formatCoverageWarning(report: FixtureCoverageReport): string {
  if (report.warnings.length === 0) return '';
  const details = report.warnings
    .map((c) => `  ch${c.offset} "${c.name}" (${c.type}) jamais écrit`)
    .join('\n');
  const accepted = report.channels.filter(
    (c) => c.status === 'preset' || c.status === 'macro' || c.status === 'silent-benign',
  ).length;
  return (
    `[COVERAGE] ${report.fixtureName} (${report.fixtureDefId}) : ` +
    `${report.writtenChannels}/${report.totalChannels} canaux écrits, ` +
    `${accepted} exclus volontairement — ${report.warnings.length} canal(aux) parlant(s) NON écrit(s) :\n${details}`
  );
}