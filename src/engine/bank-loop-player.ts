/**
 * Bank Loop Player — moteur dédié aux banques pré-programmées (4 × 32)
 * lancées depuis un widget Performance.
 *
 * Réutilise EXACTEMENT le même pipeline que la page AutoLoops :
 *   patch → toAutoloopFixtures → buildThemedBanks (Couleurs/Effets/Matrice/Mix)
 *   → AutoloopPlaybackEngine → sortie arbitre 'auto-loop' (LTP 75).
 *
 * Contrairement à `auto-loop-player.ts` (recettes LoopRecipe du catalogue 36),
 * ce moteur joue directement une `AutoloopTimeline` de la matrice 4×32 : le
 * widget pointe une case de banque (banque + slot), pas une recette.
 *
 * La matrice est mise en cache par signature de patch — un clic rejoue la
 * banque sans reconstruire les 128 timelines.
 */

import type { PatchedFixture } from '../stores/showStore';
import { useShowStore } from '../stores/showStore';
import { useClockStore } from '../stores/clockStore';
import { loadFixtureDefinitions } from '../hooks/dmx-cues';
import { toAutoloopFixtures } from './autoloop-runtime';
import { buildThemedBanks } from './autoloop-themes';
import { AutoloopPlaybackEngine } from './autoloop-engine';
import { createAutoLoopOutput } from './autoloop-adapter';
import type { AutoloopPlaybackEngine as EngineType } from './autoloop-engine';
import type { BankManager } from './autoloop-banks';

const BEATS_PER_BAR = 4;

interface ActiveBankLoop {
  raf: number;
  engine: EngineType;
  startTime: number;
}

const activeLoops = new Map<string, ActiveBankLoop>();

// ── Cache de la matrice 4×32 par signature de patch ─────────────────────────

let banksCache: { key: string; banks: BankManager } | null = null;
let banksBuilding: Promise<BankManager> | null = null;

/** Signature du patch : ids de définitions + count de positions (les labels/langue n'affectent pas le playback). */
function patchSignature(): string {
  const store = useShowStore.getState();
  return store.patchedFixtures.map((f) => f.fixtureDefId).join(',') + '|' + Object.keys(store.fixturePositions ?? {}).length;
}

/**
 * Construit (ou retourne depuis le cache) la matrice 4×32 du patch courant.
 * Retourne null si aucun fixture patchée.
 */
export async function getThemedBanks(): Promise<BankManager | null> {
  const store = useShowStore.getState();
  if (!store.patchedFixtures?.length) return null;
  const key = patchSignature();
  if (banksCache && banksCache.key === key) return banksCache.banks;
  if (banksBuilding) return banksBuilding;
  banksBuilding = (async () => {
    const ids = [...new Set(store.patchedFixtures.map((f) => f.fixtureDefId))];
    const defs = await loadFixtureDefinitions(ids);
    const fixtures = toAutoloopFixtures(store.patchedFixtures, defs, store.universes, store.fixturePositions);
    const banks = buildThemedBanks(fixtures);
    banksCache = { key, banks };
    return banks;
  })().finally(() => { banksBuilding = null; });
  return banksBuilding;
}

/** Invalide le cache (appelé si le patch change — best effort, la signature couvre déjà ce cas). */
export function invalidateBanksCache(): void {
  banksCache = null;
}

// ── Lecture / arrêt ──────────────────────────────────────────────────────────

/**
 * Démarre le slot `(bankIndex, slotIndex)` de la matrice thématique sous la
 * clé `key` (typiquement l'id du widget). Toggle géré par l'appelant.
 */
export async function startBankLoop(key: string, bankIndex: number, slotIndex: number): Promise<void> {
  stopBankLoop(key);
  const banks = await getThemedBanks();
  if (!banks) return;
  // Le patch a pu changer pendant l'attente → revalider depuis le cache frais.
  const timeline = banks.get(bankIndex, slotIndex);
  if (!timeline) return;
  if (activeLoops.has(key)) return; // déjà (re)démarré pendant l'attente

  const store = useShowStore.getState();
  const output = createAutoLoopOutput(store.patchedFixtures, store.universes);
  const engine = new AutoloopPlaybackEngine(output, 120);
  engine.load(timeline);
  engine.trigger();

  const h: ActiveBankLoop = { raf: 0, engine, startTime: performance.now() };
  activeLoops.set(key, h);

  const tick = (now: number) => {
    const cur = activeLoops.get(key);
    if (cur !== h) return; // arrêté/relancé entre-temps
    const masterBpm = useClockStore.getState().bpm;
    const bpm = masterBpm > 0 ? masterBpm : 120;
    const elapsed = now - h.startTime;
    const beatMs = 60000 / Math.max(1, bpm);
    const totalBeats = elapsed / beatMs;
    const bar = Math.floor(totalBeats / BEATS_PER_BAR);
    const beat = totalBeats - bar * BEATS_PER_BAR;
    h.engine.onBarBeat(bar, beat);
    h.raf = requestAnimationFrame(tick);
  };
  h.raf = requestAnimationFrame(tick);
}

/** Arrête la boucle `key` (flush de zéros + release de la source par engine.stop). */
export function stopBankLoop(key: string): void {
  const h = activeLoops.get(key);
  if (!h) return;
  cancelAnimationFrame(h.raf);
  activeLoops.delete(key);
  try { h.engine.stop(); } catch { /* flush best effort */ }
}

export function isBankLoopActive(key: string): boolean {
  return activeLoops.has(key);
}

export function stopAllBankLoops(): void {
  for (const key of [...activeLoops.keys()]) stopBankLoop(key);
}
