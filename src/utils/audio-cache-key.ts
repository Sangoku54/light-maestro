/**
 * Clé de cache pour un contenu audio (base64 ou data-URL).
 *
 * AVANT : `b64.slice(0, 200)` — les 200 premiers caractères du base64.
 * Problèmes :
 *  - deux audios différents dont les 200 premiers caractères coïncident
 *    partagent la MÊME entrée → le MAUVAIS audio est joué ;
 *  - le même son stocké en data-URL (`data:audio/mpeg;base64,…`) et en
 *    base64 nu donnait DEUX clés différentes → deux AudioBuffers de 80 Mo
 *    dans un cache pourtant borné à 3.
 *
 * La clé retient la LONGUEUR + le début + la fin du contenu : deux fichiers
 * audio différents doivent avoir la même taille ET les mêmes 64 premiers ET
 * les mêmes 64 derniers caractères pour entrer en collision.
 *
 * La forme data-URL est normalisée (le préfixe `data:…;base64,` est retiré)
 * pour que les deux représentations d'un même son partagent la clé.
 */
export function audioCacheKey(b64: string): string {
  if (!b64) return 'empty';
  const marker = ';base64,';
  const idx = b64.indexOf(marker);
  const raw = b64.startsWith('data:') && idx >= 0 ? b64.slice(idx + marker.length) : b64;
  const head = raw.slice(0, 64);
  const tail = raw.length > 64 ? raw.slice(-64) : '';
  return `${raw.length}:${head}:${tail}`;
}
