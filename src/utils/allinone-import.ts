/* All-In-One (openmirlab) → light-maestro structure import.
 *
 * Option B (offline) : un script Python à part fait tourner le modèle
 * `all-in-one-infer` sur un WAV et sort un JSON (segments fonctionnels +
 * tempo/temps). Ce module ne fait QUE parser ce JSON et le convertir vers
 * nos `TrackSection` — aucune dépendance ML ici, 100% testable en virtuel.
 *
 * Format accepté (notre normalisation `light-maestro-structure-v1`,
 * compatible avec le JSON brut du CLI all-in-one-infer) :
 *   { bpm, beats|beat_positions, downbeats, segments: [{start,end,label}] }
 */

import { SECTION_COLORS, type TrackSection } from '../hooks/audio-analysis';

export type AllInOneLabel =
  | 'start' | 'end' | 'intro' | 'outro' | 'verse' | 'chorus'
  | 'bridge' | 'break' | 'inst' | 'solo';

export interface AllInOneSegment {
  start: number;
  end: number;
  label: string;
}

export interface AllInOneStructureJson {
  format?: string;
  bpm?: number;
  beats?: number[];
  beat_positions?: number[];
  beatPositions?: number[];
  downbeats?: number[];
  duration?: number;
  segments?: AllInOneSegment[];
}

export interface MappedStructure {
  sections: TrackSection[];
  bpm?: number;
  beats?: number[];
  beatPositions?: number[];
  downbeats?: number[];
  duration: number;
}

/** Mapping des 10 labels Harmonix vers nos 6 types de sections.
 *  - break (pause/transition calme) → bridge
 *  - inst (passage instrumental neutre) → verse
 *  - solo (moment mis en avant, énergique) → chorus
 *  - start/end (marqueurs) → ignorés (pas des sections)
 */
const LABEL_MAP: Record<string, TrackSection['type'] | null> = {
  intro: 'intro',
  outro: 'outro',
  verse: 'verse',
  chorus: 'chorus',
  bridge: 'bridge',
  break: 'bridge',
  inst: 'verse',
  solo: 'chorus',
  start: null,
  end: null,
};

const DEFAULT_ENERGY: Record<TrackSection['type'], number> = {
  intro: 0.25,
  verse: 0.5,
  chorus: 0.85,
  bridge: 0.35,
  drop: 0.95,
  build: 0.7,
  outro: 0.2,
  unknown: 0.5,
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function cleanSeries(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(isFiniteNumber);
  return out.length > 0 ? out : undefined;
}

export function mapAllInOneLabel(label: string): TrackSection['type'] | null {
  return LABEL_MAP[label.trim().toLowerCase()] ?? null;
}

/** Parse + valide un JSON All-In-One (brut CLI ou normalisé v1). */
export function parseAllInOneJson(text: string): AllInOneStructureJson {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('All-In-One : JSON invalide.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('All-In-One : objet JSON attendu.');
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.segments)) {
    throw new Error('All-In-One : champ "segments" manquant.');
  }
  return obj as AllInOneStructureJson;
}

/** Convertit les segments All-In-One en sections light-maestro.
 *  - trie, clamp à [0, duration], ignore start/end et segments vides
 *  - absorbe les micro-segments (< 1s) dans le voisin précédent
 *  - fusionne les voisins de même type
 */
export function mapAllInOneToSections(
  input: AllInOneStructureJson,
  durationHint?: number,
): MappedStructure {
  const raw = Array.isArray(input.segments) ? input.segments : [];
  const explicitDuration = isFiniteNumber(input.duration) && (input.duration as number) > 0
    ? (input.duration as number)
    : undefined;
  const hinted = isFiniteNumber(durationHint) && (durationHint as number) > 0
    ? (durationHint as number)
    : undefined;

  type Norm = { start: number; end: number; type: TrackSection['type'] };
  const norm: Norm[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const seg = s as { start?: unknown; end?: unknown; label?: unknown };
    if (!isFiniteNumber(seg.start) || !isFiniteNumber(seg.end)) continue;
    if (typeof seg.label !== 'string') continue;
    const type = mapAllInOneLabel(seg.label);
    if (!type) continue; // start/end ignorés
    if (seg.end <= seg.start) continue;
    norm.push({ start: seg.start, end: seg.end, type });
  }
  if (norm.length === 0) {
    throw new Error('All-In-One : aucun segment exploitable (labels start/end uniquement ?).');
  }
  norm.sort((a, b) => a.start - b.start);

  const contentEnd = norm[norm.length - 1].end;
  const duration = explicitDuration ?? hinted ?? contentEnd;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('All-In-One : durée invalide.');
  }

  // Clamp + absorption des micro-segments (< 1s) dans le précédent.
  const cleaned: Norm[] = [];
  for (const s of norm) {
    const start = Math.max(0, Math.min(duration, s.start));
    const end = Math.max(0, Math.min(duration, s.end));
    if (end - start < 1) {
      const prev = cleaned[cleaned.length - 1];
      if (prev) prev.end = Math.max(prev.end, end);
      continue;
    }
    cleaned.push({ start, end, type: s.type });
  }
  if (cleaned.length === 0) {
    throw new Error('All-In-One : aucun segment après nettoyage.');
  }

  // Fusion des voisins de même type (chevauchement/contiguïté tolérée).
  const merged: Norm[] = [];
  for (const s of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.type === s.type && s.start <= last.end + 0.5) {
      last.end = Math.max(last.end, s.end);
    } else {
      merged.push({ ...s });
    }
  }

  // Calage des frontières internes sur les temps du modèle (±0,3s max).
  // Corrige les petits offsets (décodeur MP3, arrondis) sans déplacer
  // une frontière vraiment hors-temps. Début/fin gardés tels quels.
  const beatGrid = cleanSeries(input.beats)
    ?? cleanSeries((input as { beat_positions?: unknown }).beat_positions)
    ?? cleanSeries(input.beatPositions);
  if (beatGrid) {
    const boundarySet = new Set<number>();
    for (let i = 1; i < merged.length; i++) boundarySet.add(i);
    for (const i of boundarySet) {
      const t = merged[i].start;
      let best = t;
      let bestD = 0.3;
      for (const b of beatGrid) {
        const d = Math.abs(b - t);
        if (d < bestD) { bestD = d; best = b; }
        if (b > t + 0.3) break;
      }
      if (best !== t) {
        merged[i].start = best;
        merged[i - 1].end = best;
      }
    }
  }

  const sections: TrackSection[] = merged.map((s) => ({
    type: s.type,
    startTime: Math.round(s.start * 100) / 100,
    endTime: Math.round(s.end * 100) / 100,
    energy: DEFAULT_ENERGY[s.type],
    color: SECTION_COLORS[s.type] ?? '#4b5563',
  }));

  const beats = cleanSeries(input.beats)
    ?? cleanSeries((input as { beat_positions?: unknown }).beat_positions)
    ?? cleanSeries(input.beatPositions);
  const beatPositions = cleanSeries(input.beatPositions)
    ?? cleanSeries((input as { beat_positions?: unknown }).beat_positions)
    ?? beats;
  const downbeats = cleanSeries(input.downbeats);
  const bpm = isFiniteNumber(input.bpm) ? (input.bpm as number) : undefined;

  return { sections, bpm, beats, beatPositions, downbeats, duration };
}
