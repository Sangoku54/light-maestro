/* Réparation audio des presets — logique pure (testée).
 *
 * Certains .lmpreset ont été exportés SANS `audioDataBase64` (le poids vient
 * alors de l'analyse sérialisée, pas d'un MP3). Ces helpers décident si un
 * preset a besoin d'une réparation et l'appliquent (le batch sur dossier vit
 * dans le main Electron, qui ne peut pas importer src/).
 */

export interface PresetLike {
  quickShow?: { name?: string };
  analysis?: { fileName?: string };
  audioDataBase64?: unknown;
}

/** Vrai si le preset n'embarque aucun audio (champ absent, vide ou non-string). */
export function presetNeedsAudio(data: PresetLike | null | undefined): boolean {
  if (!data || typeof data !== 'object') return false;
  const raw = (data as { audioDataBase64?: unknown }).audioDataBase64;
  return !(typeof raw === 'string' && raw.length > 0);
}

/** Nom du preset (clé du cache last-audio), avec repli sur le nom de fichier. */
export function presetRepairName(data: PresetLike, fileName: string): string {
  const fromPreset = data?.quickShow?.name;
  if (typeof fromPreset === 'string' && fromPreset.trim()) return fromPreset;
  return fileName.replace(/\.lmpreset$/i, '');
}

/** Nom du fichier audio attendu (pour le rapport des irréparables). */
export function expectedAudioName(data: PresetLike): string {
  const n = data?.analysis?.fileName;
  return typeof n === 'string' && n ? n : '(nom audio inconnu)';
}

/** Retourne une copie du preset avec l'audio ré-embarqué (raw base64, sans préfixe data:). */
export function embedPresetAudio<T extends PresetLike>(data: T, base64: string): T {
  const stripped = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  return { ...data, audioDataBase64: stripped };
}
