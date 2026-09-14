/**
 * Registre du « dernier bon audio » par nom de preset, persistant (IPC,
 * userData/last-audio.json — évite le quota de localStorage pour ~78 Mo de
 * base64). Permet :
 * - à un ré-export depuis une session fraîche de réutiliser le dernier audio
 *   connu (sinon l'export écrirait un .lmpreset SANS son et écraserait le bon) ;
 * - au chargement d'un .lmpreset devenu sans son de restaurer l'audio depuis
 *   ce cache ;
 * - à la LECTURE (widget) de récupérer l'audio quand l'entrée du store l'a
 *   perdu (doublon muet, projet sauvé après écrasement).
 */

export type LastAudioEntry = { base64: string; fileName?: string; ts: string };

export async function lastAudioLoad(): Promise<Record<string, LastAudioEntry>> {
  try {
    const api = (window as any).lightMaestro?.lastAudio;
    const m = await api?.load();
    return m && typeof m === 'object' ? (m as Record<string, LastAudioEntry>) : {};
  } catch { return {}; }
}

export async function lastAudioRemember(name: string, base64: string | undefined, fileName?: string) {
  if (!base64) return;
  try {
    const api = (window as any).lightMaestro?.lastAudio;
    if (!api) return;
    const map = await lastAudioLoad();
    map[name] = { base64, fileName, ts: new Date().toISOString() };
    await api.save(map);
  } catch { /* non-bloquant */ }
}
