import { describe, it, expect, beforeEach } from 'vitest';
import { useProgrammerStore } from '../stores/programmerStore';
import { useShowStore } from '../stores/showStore';

/**
 * Non-régression : la Target (pan/tilt programmeur) doit survivre à une purge
 * silencieuse du programmeur (preview scène / reset 3D) via le backup
 * `window.__lm_programmerBackup`, puis être enregistrée dans une scène.
 *
 * Réplique le flux UI : Target → clear (preview) → handleStore lit le backup.
 */
describe('Target → purge programmeur → sauvegarde via backup', () => {
  beforeEach(() => {
    useProgrammerStore.getState().clear();
    (globalThis as any).__lm_programmerBackup = undefined;
  });

  it('clear() pose un backup non vide avant de vider les canaux', () => {
    const setCh = useProgrammerStore.getState().setChannel;
    setCh(7, 200);
    setCh(8, 40);
    expect(Object.keys(useProgrammerStore.getState().channels).length).toBe(2);

    useProgrammerStore.getState().clear();

    expect(useProgrammerStore.getState().isActive).toBe(false);
    expect(Object.keys(useProgrammerStore.getState().channels).length).toBe(0);
    const backup = (globalThis as any).__lm_programmerBackup as Record<number, number>;
    expect(backup).toBeTruthy();
    expect(backup[7]).toBe(200);
    expect(backup[8]).toBe(40);
  });

  it('clear() sur programmeur vide ne pose PAS de backup (pas d’écrasement)', () => {
    (globalThis as any).__lm_programmerBackup = { 1: 99 };
    (globalThis as any).__lm_programmerBackupAt = 1;
    useProgrammerStore.getState().clear();
    // channels déjà vides → clear ne doit pas écraser le backup existant
    expect((globalThis as any).__lm_programmerBackup?.[1]).toBe(99);
  });

  it('le backup ne contient JAMAIS de clé `at` (horodatage à part)', () => {
    useProgrammerStore.getState().setChannel(7, 200);
    useProgrammerStore.getState().clear();
    const backup = (globalThis as any).__lm_programmerBackup as Record<string, number>;
    expect(backup.at).toBeUndefined();
    expect((globalThis as any).__lm_programmerBackupAt).toBeGreaterThan(0);
    // Toutes les clés restantes doivent être des adresses DMX numériques
    for (const k of Object.keys(backup)) {
      expect(/^\d+$/.test(k)).toBe(true);
    }
  });

  it('flux complet : Target → clear preview → handleStore lit le backup et crée la scène', () => {
    const setCh = useProgrammerStore.getState().setChannel;
    setCh(64, 180); // pan
    setCh(66, 90);  // tilt

    // Preview scène purge le programmeur pendant que la modale Store est ouverte
    useProgrammerStore.getState().clear();
    expect(Object.keys(useProgrammerStore.getState().channels).length).toBe(0);

    // Réplique handleStore (mode new) avec fallback backup
    const live = useProgrammerStore.getState().channels;
    const backup = (globalThis as any).__lm_programmerBackup as Record<number, number> | undefined;
    const snap = Object.keys(live).length > 0 ? live : (backup && Object.keys(backup).length > 0 ? backup : {});
    expect(Object.keys(snap).length).toBeGreaterThan(0);

    const s = useShowStore.getState();
    const id = s.createScene('Target saved');
    s.updateScene(id, { channels: { ...snap } });

    const sc = useShowStore.getState().scenes.find((x) => x.id === id);
    expect(sc).toBeTruthy();
    expect(sc!.channels[64]).toBe(180);
    expect(sc!.channels[66]).toBe(90);

    useProgrammerStore.getState().clear();
    (globalThis as any).__lm_programmerBackup = undefined;
  });

  it('mode update merge le backup dans la scène existante sans perdre les anciens canaux', () => {
    const s0 = useShowStore.getState();
    const sid = s0.createScene('Existing');
    s0.updateScene(sid, { channels: { 10: 50 } });

    const setCh = useProgrammerStore.getState().setChannel;
    setCh(64, 200);
    useProgrammerStore.getState().clear();

    const backup = (globalThis as any).__lm_programmerBackup as Record<number, number>;
    const sc = useShowStore.getState().scenes.find((x) => x.id === sid)!;
    const merged = { ...sc.channels };
    for (const [k, v] of Object.entries(backup)) merged[Number(k)] = v;
    useShowStore.getState().updateScene(sid, { channels: merged });

    const after = useShowStore.getState().scenes.find((x) => x.id === sid)!;
    expect(after.channels[10]).toBe(50);
    expect(after.channels[64]).toBe(200);
  });
});
