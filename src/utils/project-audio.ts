/**
 * project-audio.ts — Externalisation des blobs audio du projet (.lmproj).
 *
 * Problème : les songPresets embarquent `audioFileBase64` (l'audio complet en
 * base64 : 55 Mo par chanson !) et les shows embarquent le même audio dans
 * `audioFileBase64` + `tracks[].audioFileBase64`. Le JSON.stringify du projet
 * dépasse alors la taille maximale de string de V8 (~536 Mo) → RangeError:
 * Invalid string length → la sauvegarde échoue silencieusement (aucun
 * dialogue, aucun toast) après ~8 presets paramétrés.
 *
 * Fix : les blobs audio sont stockés dans userData via
 * window.lightMaestro.storage.set/get (fichiers `audio-<hash>.json`) ; le
 * projet embarque des références `audioRef: '<clé>'`. Déduplication par
 * hash SHA-256 : un même audio présent dans un preset ET copié dans une
 * track de show ne produit qu'un seul fichier. L'audio absent au chargement
 * n'est pas bloquant : le playback DMX passe sur horloge virtuelle.
 */

const BLOB_PREFIX = 'audio-';
/** En dessous de 1 Ko : garder en clair (éviter un fichier par blip). */
const EXTRACT_MIN_BYTES = 1024;

export interface ExtractedBlob {
  key: string;
  audioFileBase64: string;
}

export interface AudioFields {
  audioFileBase64?: string;
  audioRef?: string;
}

export interface StorageLike {
  set: (key: string, data: any) => Promise<boolean>;
  has: (key: string) => Promise<boolean>;
}

/**
 * Sépare un champ audio : data URL (`data:audio/mpeg;base64,AAAA`) ou base64
 * nu. Le hash est calculé sur la partie base64 pure → un même audio avec un
 * mime différent (ou en data URL vs nu) déduplique vers la même clé.
 */
function splitAudioField(field: string): { b64: string } {
  const marker = ';base64,';
  const idx = field.indexOf(marker);
  if (field.startsWith('data:') && idx >= 0) return { b64: field.slice(idx + marker.length) };
  return { b64: field };
}

/**
 * Clé de stockage stable pour un blob audio : `audio-<hex16 du SHA-256>`.
 * Déduplique les audios identiques (preset + track copiée = 1 fichier).
 */
export async function audioKeyOf(field: string): Promise<string> {
  const { b64 } = splitAudioField(field);
  // base64 → octets (le contenu est ASCII, atob suffit et est rapide)
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return BLOB_PREFIX + hex.slice(0, 16);
}

/**
 * Extrait un champ audio : au-dessus du seuil → référence `audioRef` + blob
 * retourné ; en dessous (ou absent) → champ inchangé en clair.
 */
export async function extractAudioField(field: string | undefined): Promise<{ value: AudioFields; blob?: ExtractedBlob }> {
  if (!field || field.length < EXTRACT_MIN_BYTES) {
    return { value: field === undefined ? {} : { audioFileBase64: field } };
  }
  const key = await audioKeyOf(field);
  return { value: { audioRef: key }, blob: { key, audioFileBase64: field } };
}

/**
 * Résout l'audio des widgets VC (ex. audioAutoScript : config.audioDataUrl,
 * data URL complète) : audioRef → blob depuis userData au chargement.
 */
export async function resolveWidgetAudio(
  widgets: any[],
  get: (key: string) => Promise<any>,
): Promise<any[]> {
  // SÉQUENTIEL (pas de Promise.all) : chaque blob fait 55 Mo, les lire en
  // parallèle ferait monter le pic mémoire à N×55 Mo → OOM sur machine peu
  // mémoire (Surface).
  const out: any[] = [];
  for (const w of widgets ?? []) {
    if (!w?.config?.audioRef) { out.push(w); continue; }
    try {
      const stored = await get(w.config.audioRef);
      // Le getter peut renvoyer une string base64 brute (enveloppe .lmproj)
      // ou un objet { audioFileBase64 } (storage userData).
      const url = typeof stored === 'string' ? stored : stored?.audioFileBase64;
      if (typeof url === 'string') {
        const { audioRef: _r, ...rest } = w.config;
        out.push({ ...w, config: { ...rest, audioDataUrl: url } });
        continue;
      }
    } catch { /* blob absent — widget silencieux, pas de crash */ }
    out.push(w);
  }
  return out;
}

/**
 * Extrait un champ audio d'une entité (preset, show, show track item).
 * 3 cas :
 *  1) base64 direct et gros → externalisé : audioRef calculée + blob NOUVEAU
 *     (contenu en mémoire, à écrire dans le userData).
 *  2) audioRef existant (audio déjà externalisé lors d'une session précédente)
 *     → PRÉSERVÉ. Le blob est DÉJÀ dans le userData : on ne le relit pas
 *     (le main process le lira sur disque au moment de packer l'enveloppe).
 *  3) base64 direct et petit → gardé en clair.
 */
const extract = async (
  fields: any,
  newBlobs: Map<string, ExtractedBlob>,
  blobKeys: Set<string>,
): Promise<AudioFields> => {
  const direct = fields?.audioFileBase64;
  const ref = fields?.audioRef;
  if (typeof direct === 'string' && direct.length >= EXTRACT_MIN_BYTES) {
    const { value, blob } = await extractAudioField(direct);
    if (blob) {
      newBlobs.set(blob.key, blob);
      blobKeys.add(blob.key);
    }
    return value;
  }
  if (typeof ref === 'string' && ref.length > 0) {
    blobKeys.add(ref);
    return { audioRef: ref };
  }
  if (typeof direct === 'string') {
    // audio petit (ou vide) → gardé en clair, tel quel
    return { audioFileBase64: direct };
  }
  return {};
};

/**
 * Externe tous les blobs audio d'un projet : songPresets[].audioFileBase64,
 * shows[].audioFileBase64 et shows[].tracks[].items[].audioFileBase64.
 *
 * Retourne :
 *  - les structures allégées (audioRef) ;
 *  - `blobs` : les blobs NOUVEAUX (contenu disponible en mémoire) ;
 *  - `blobKeys` : TOUTES les clés à embarquer dans l'enveloppe .lmproj.
 *
 * Les blobs déjà externalisés (audioRef) ne sont PAS relus : leur contenu vit
 * dans le userData, le main process le lit sur disque au pack. Cela évite de
 * materialiser 55 Mo × N en base64 dans le renderer (OOM sur machine
 * peu mémoire).
 */
export async function externalizeProjectAudio(
  presets: any[],
  shows: any[],
): Promise<{ presets: any[]; shows: any[]; blobs: ExtractedBlob[]; blobKeys: string[] }> {
  const newBlobs = new Map<string, ExtractedBlob>();
  const blobKeys = new Set<string>();

  // Séquentiel (pas de Promise.all) : le hachage de 8×55 Mo en parallèle
  // pousserait le renderer à ~1 Go de RAM — l'ordre n'importe pas.
  const outPresets: any[] = [];
  for (const p of presets) {
    if (!p || typeof p !== 'object') { outPresets.push(p); continue; }
    const value = await extract(p, newBlobs, blobKeys);
    // Supprime le champ audio d'origine (le spread ne le retire pas)
    const { audioFileBase64: _stripped, audioRef: _oldRef, ...rest } = p;
    outPresets.push({ ...rest, ...value });
  }

  const outShows: any[] = [];
  for (const s of shows) {
    if (!s || typeof s !== 'object') { outShows.push(s); continue; }
    const sFields = await extract(s, newBlobs, blobKeys);
    const tracks: any[] = [];
    for (const t of Array.isArray(s.tracks) ? s.tracks : []) {
      if (!t || typeof t !== 'object') { tracks.push(t); continue; }
      // L'audio vit dans items[].audioFileBase64 (ShowTrackItem), pas sur la
      // track elle-même.
      const items: any[] = [];
      for (const it of Array.isArray(t.items) ? t.items : []) {
        if (!it || typeof it !== 'object') { items.push(it); continue; }
        const iFields = await extract(it, newBlobs, blobKeys);
        const { audioFileBase64: _si, audioRef: _iri, ...iRest } = it;
        items.push({ ...iRest, ...iFields });
      }
      tracks.push({ ...t, items });
    }
    const { audioFileBase64: _ss, audioRef: _sr2, ...sRest } = s;
    outShows.push({ ...sRest, ...sFields, tracks });
  }

  return {
    presets: outPresets,
    shows: outShows,
    blobs: Array.from(newBlobs.values()),
    blobKeys: Array.from(blobKeys),
  };
}

/**
 * Résout les références audio d'un projet chargé : `audioRef` → blob depuis
 * userData (via le getter fourni). Les blobs en clair (projets v1) passent
 * tels quel. Un blob manquant → `audioFileBase64` absent : le playback DMX
 * continue sur horloge virtuelle (comportement conçu et testé).
 */
export async function resolveProjectAudio(
  presets: any[],
  shows: any[],
  get: (key: string) => Promise<any>,
): Promise<{ presets: any[]; shows: any[] }> {
  // PAS D'HYDRATATION : le base64 (55 Mo par preset) resterait resident en
  // mémoire → OOM au chargement d'un gros projet sur machine peu.memory.
  // On conserve la référence (`audioRef`) ; le blob est relu À LA DEMANDE
  // au moment de la lecture (resolveAudioUrl → resolverregistre).
  const outPresets = (presets ?? []).map((p: any) => {
    if (!p || typeof p !== 'object') return p;
    // v1 : blob en clair dans le manifeste → on conserve tel quel.
    if (typeof p.audioFileBase64 === 'string') return p;
    // v2 : référence externalisée → on garde l'audioRef, pas de base64.
    if (typeof p.audioRef === 'string' && p.audioRef.length > 0) {
      const { audioFileBase64: _drop, ...rest } = p;
      return { ...rest, audioRef: p.audioRef };
    }
    return p;
  });

  const outShows = (shows ?? []).map((s: any) => {
    if (!s || typeof s !== 'object') return s;
    const tracks = Array.isArray(s.tracks)
      ? s.tracks.map((t: any) => {
        if (!t || typeof t !== 'object') return t;
        const items = Array.isArray(t.items)
          ? t.items.map((it: any) => {
            if (!it || typeof it !== 'object') return it;
            if (typeof it.audioFileBase64 === 'string') return it;
            if (typeof it.audioRef === 'string' && it.audioRef.length > 0) {
              const { audioFileBase64: _drop, ...rest } = it;
              return { ...rest, audioRef: it.audioRef };
            }
            return it;
          })
          : t.items;
        return { ...t, items };
      })
      : s.tracks;
    // L'audio de la show elle-même : référence conservée, pas de base64.
    const { audioFileBase64: _dropShow, ...showRest } = s;
    return { ...showRest, tracks };
  });

  void get; // le getter reste dans la signature (compat) mais n'est plus utilisé ici
  return { presets: outPresets, shows: outShows };
}

/**
 * Résout l'URL audio d'un preset au moment de la lecture : base64 direct
 * d'abord, sinon blob `audioRef` via le stockage userData.
 *
 * Après une sauvegarde, le projet ne contient plus que `audioRef` (le base64
 * complet vit dans userData ou dans l'enveloppe .lmproj). `SongPresetPlayer`
 * ne savait lire que `audioFileBase64` → silence après rechargement alors que
 * le show lumière tournait sur l'horloge virtuelle. Cette fonction comble ce
 * trou sans toucher au cycle save/load.
 *
 * Retourne la chaîne base64 / data URL, ou null si aucune source disponible.
 * Ne logue jamais le contenu base64 (longueurs uniquement côté appelant).
 */
export async function resolveAudioUrl(
  fields: { audioFileBase64?: string; audioDataBase64?: string; audioRef?: string },
  get?: (key: string) => Promise<any>,
): Promise<string | null> {
  const direct = fields?.audioFileBase64 || (fields as any)?.audioDataBase64;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const ref = (fields as any)?.audioRef;
  if (!ref) return null;
  const getter = get || ((k: string) => (window as any).lightMaestro?.storage?.get?.(k));
  try {
    const stored = await getter(ref);
    // Le getter peut renvoyer une string base64 brute (enveloppe .lmproj)
    // ou un objet { audioFileBase64 } (storage userData).
    if (typeof stored === 'string') return stored.length > 0 ? stored : null;
    const b64 = stored?.audioFileBase64;
    return typeof b64 === 'string' && b64.length > 0 ? b64 : null;
  } catch {
    return null;
  }
}

/**
 * Écrit les blobs externes dans userData (skip si déjà stocké : les saves
 * suivants ne réécrivent pas les mêmes audios).
 */
export async function writeAudioBlobs(blobs: ExtractedBlob[], storage: StorageLike): Promise<void> {
  for (const b of blobs) {
    try {
      const exists = await storage.has(b.key);
      if (exists) continue;
      await storage.set(b.key, { audioFileBase64: b.audioFileBase64 });
    } catch (e) {
      // Un blob qui échoue ne doit pas bloquer la sauvegarde : le playback
      // survivra sans l'audio (horloge virtuelle) — loggué pour le diagnostic.
      console.warn(`[project-audio] Échec d'écriture du blob ${b.key} :`, e);
    }
  }
}
