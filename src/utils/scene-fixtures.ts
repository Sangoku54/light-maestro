/**
 * Scene ↔ Fixture mapping helpers (DesignView scene filtering).
 *
 * The predicate here MUST stay identical to the playback engine:
 * - dispatchChannelsByFixture (src/utils/dmx-helpers.ts): a scene value
 *   is sent to every fixture whose [startAddress, startAddress+channelCount)
 *   range contains the address — across ALL universes (scene addresses are
 *   per-universe 1..512 with no universe id, so the same address lights up
 *   fixtures on every universe that contains it).
 * - computeChaserTrackOverrides (src/hooks/dmx-playback.ts) uses the exact
 *   same range predicate over every scene.channels key, value irrelevant.
 *
 * So "scene touches fixture" = ∃ address in scene.channels such that
 * fixture.startAddress <= addr < fixture.startAddress + fixture.channelCount.
 * Value is irrelevant (a 0 is legitimate data, e.g. closed shutter).
 */

import type { PatchedFixture, SavedScene } from '../stores/showStore';

/** Normalize a user-typed folder name: trim + collapse inner whitespace.
 *  " front  lights " → "front lights". Empty/whitespace-only → "". */
export function normalizeFolderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Union of declared folders (sceneFolders entities) and folders derived from
 *  scene.folder, normalized, deduped (case-sensitive), sorted A→Z.
 *  Declared-but-empty folders are preserved (they are real entities). */
export function collectFolderNames(declared: string[], scenes: SavedScene[]): string[] {
  const set = new Set<string>();
  for (const f of declared) {
    const n = normalizeFolderName(f);
    if (n) set.add(n);
  }
  for (const s of scenes) {
    const n = normalizeFolderName(s.folder || '');
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** True when the scene has at least one channel address inside the fixture's DMX range. */
export function sceneTouchesFixture(scene: Pick<SavedScene, 'channels'>, pf: PatchedFixture): boolean {
  const end = pf.startAddress + pf.channelCount;
  for (const addrStr of Object.keys(scene.channels)) {
    const a = Number(addrStr);
    if (a >= pf.startAddress && a < end) return true;
  }
  return false;
}

/**
 * Build a two-way index in a single pass over all scenes × all fixtures.
 * - byFixture: fixtureId -> scene ids that touch it
 * - byScene:   sceneId   -> fixture ids the scene touches
 *
 * O(total scene channel entries × fixtures) worst case but typically
 * O(scenes × fixtures × small), memoized in the UI on [scenes, fixtures].
 */
export function buildSceneFixtureIndex(
  scenes: SavedScene[],
  fixtures: PatchedFixture[],
): { byFixture: Map<string, string[]>; byScene: Map<string, string[]> } {
  const byFixture = new Map<string, string[]>();
  const byScene = new Map<string, string[]>();

  for (const scene of scenes) {
    for (const pf of fixtures) {
      if (sceneTouchesFixture(scene, pf)) {
        const fList = byFixture.get(pf.id);
        if (fList) fList.push(scene.id);
        else byFixture.set(pf.id, [scene.id]);

        const sList = byScene.get(scene.id);
        if (sList) sList.push(pf.id);
        else byScene.set(scene.id, [pf.id]);
      }
    }
  }

  return { byFixture, byScene };
}

/** Scenes that do not touch ANY patched fixture range (created pre-patch, out-of-range or empty). */
export function scenesWithoutFixture(
  scenes: SavedScene[],
  byScene: Map<string, string[]>,
): SavedScene[] {
  return scenes.filter((s) => !byScene.has(s.id));
}
