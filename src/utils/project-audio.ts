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
  return Promise.all(
    (widgets ?? []).map(async (w) => {
      if (!w?.config?.audioRef) return w;
      try {
        const stored = await get(w.config.audioRef);
        // Le getter peut renvoyer une string base64 brute (enveloppe .lmproj)
        // ou un objet { audioFileBase64 } (storage userData).
        const url = typeof stored === 'string' ? stored : stored?.audioFileBase64;
        if (typeof url === 'string') {
          const { audioRef: _r, ...rest } = w.config;
          return { ...w, config: { ...rest, audioDataUrl: url } };
        }
      } catch { /* blob absent — widget silencieux, pas de crash */ }
      return w;
    }),
  );
}

/**
 * Externe tous les blobs audio d'un projet : songPresets[].audioFileBase64,
 * shows[].audioFileBase64 et shows[].tracks[].audioFileBase64.
 * Retourne les structures allégées (audioRef) + la liste des blobs à écrire
 * (dédupliqués par clé). Aucun effet de bord : ne touche pas aux stores.
 */
export async function externalizeProjectAudio(
  presets: any[],
  shows: any[],
  getBlob?: (key: string) => Promise<string | undefined>,
): Promise<{ presets: any[]; shows: any[]; blobs: ExtractedBlob[] }> {
  const blobs = new Map<string, ExtractedBlob>();
  const withBlob = async (fields: AudioFields, b?: ExtractedBlob): Promise<AudioFields> => {
    if (b) blobs.set(b.key, b);
    return fields;
  };

  // Extrait un champ audio d'une entité (preset, show, show track item).
  // 3 cas :
  //  1) base64 direct et gros → externalisé (audioRef + blob dans l'enveloppe)
  //  2) audioRef existant (audio déjà externalisé lors d'une session précédente)
  //     → PRÉSERVÉ + blob re-empaqueté dans l'enveloppe .lmproj, sinon il est
  //     perdu à la sauvegarde (l'audio disparaît au rechargement du projet)
  //  3) base64 direct et petit → gardé en clair
  const extract = async (fields: any): Promise<AudioFields> => {
    const direct = fields?.audioFileBase64;
    const ref = fields?.audioRef;
    if (typeof direct === 'string' && direct.length >= EXTRACT_MIN_BYTES) {
      const { value, blob } = await extractAudioField(direct);
      await withBlob(value, blob);
      return value;
    }
    if (typeof ref === 'string' && ref.length > 0) {
      let b64: string | undefined;
      if (getBlob) {
        try { b64 = await getBlob(ref); } catch { b64 = undefined; }
      }
      if (typeof b64 === 'string' && b64.length > 0) {
        await withBlob({ audioRef: ref }, { key: ref, audioFileBase64: b64 });
      }
      return { audioRef: ref };
    }
    if (typeof direct === 'string') {
      // audio petit (ou vide) → gardé en clair, tel quel
      return { audioFileBase64: direct };
    }
    return {};
  };

  // Séquentiel (pas de Promise.all) : le hachage de 8×55 Mo en parallèle
  // pousserait le renderer à ~1 Go de RAM — l'ordre n'importe pas.
  const outPresets: any[] = [];
  for (const p of presets) {
    if (!p || typeof p !== 'object') { outPresets.push(p); continue; }
    const value = await extract(p);
    // Supprime le champ audio d'origine (le spread ne le retire pas)
    const { audioFileBase64: _stripped, audioRef: _oldRef, ...rest } = p;
    outPresets.push({ ...rest, ...value });
  }

  const outShows: any[] = [];
  for (const s of shows) {
    if (!s || typeof s !== 'object') { outShows.push(s); continue; }
    const sFields = await extract(s);
    await withBlob(sFields);
    const tracks: any[] = [];
    for (const t of Array.isArray(s.tracks) ? s.tracks : []) {
      if (!t || typeof t !== 'object') { tracks.push(t); continue; }
      // L'audio vit dans items[].audioFileBase64 (ShowTrackItem), pas sur la
      // track elle-même.
      const items: any[] = [];
      for (const it of Array.isArray(t.items) ? t.items : []) {
        if (!it || typeof it !== 'object') { items.push(it); continue; }
        const iFields = await extract(it);
        await withBlob(iFields);
        const { audioFileBase64: _si, audioRef: _iri, ...iRest } = it;
        items.push({ ...iRest, ...iFields });
      }
      tracks.push({ ...t, items });
    }
    const { audioFileBase64: _ss, audioRef: _sr2, ...sRest } = s;
    outShows.push({ ...sRest, ...sFields, tracks });
  }

  return { presets: outPresets, shows: outShows, blobs: Array.from(blobs.values()) };
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
  const fetchBlob = async (key: string): Promise<string | undefined> => {
    try {
      const stored = await get(key);
      // Le getter peut renvoyer :
      //  - une string base64 brute (blobs de l'enveloppe .lmproj)
      //  - un objet { audioFileBase64 } (storage userData)
      if (typeof stored === 'string') return stored.length > 0 ? stored : undefined;
      const b64 = stored?.audioFileBase64;
      return typeof b64 === 'string' ? b64 : undefined;
    } catch {
      return undefined;
    }
  };

  const hydrate = async (fields: AudioFields): Promise<string | undefined> => {
    // v1 : blob en clair dans le fichier
    if (typeof fields?.audioFileBase64 === 'string') return fields.audioFileBase64;
    // v2 : référence vers userData
    if (fields?.audioRef) return fetchBlob(fields.audioRef);
    return undefined;
  };

  const outPresets = await Promise.all(
    (presets ?? []).map(async (p) => {
      if (!p || typeof p !== 'object') return p;
      const b64 = await hydrate(p);
      return b64 === undefined ? { ...p, audioFileBase64: undefined } : { ...p, audioFileBase64: b64 };
    }),
  );

  const outShows = await Promise.all(
    (shows ?? []).map(async (s) => {
      if (!s || typeof s !== 'object') return s;
      const b64 = await hydrate(s);
      const tracks = Array.isArray(s.tracks)
        ? await Promise.all(
            s.tracks.map(async (t: any) => {
              if (!t || typeof t !== 'object') return t;
              // items[].audioFileBase64 (ShowTrackItem) — pas la track elle-même
              const items = await Promise.all(
                (Array.isArray(t.items) ? t.items : []).map(async (it: any) => {
                  if (!it || typeof it !== 'object') return it;
                  const ib = await hydrate(it);
                  return ib === undefined ? { ...it, audioFileBase64: undefined } : { ...it, audioFileBase64: ib };
                }),
              );
              return { ...t, items };
            }),
          )
        : s.tracks;
      return b64 === undefined
        ? { ...s, audioFileBase64: undefined, tracks }
        : { ...s, audioFileBase64: b64, tracks };
    }),
  );

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
