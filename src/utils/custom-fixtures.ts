// ─── Portabilité des fixtures personnalisées ──────────────────────────────
// Les fixtures "custom" (créées dans l'éditeur de fixtures) sont stockées dans
// userData/fixtures/ et NE sont PAS embarquées dans le .exe packagé (seules les
// 2221 fixtures standard le sont). Sur une machine vierge (PC live, poste d'un
// distributeur), getDefinition('custom-…') renvoie donc `undefined`, ce qui casse
// tout ce qui référence ces fixtures (fixtures patchées, scènes, chasers, presets
// des widgets…).
//
// Solution : embarquer les définitions custom dans le fichier projet (.lmproj /
// .lmshow) au moment de la sauvegarde, et les ré-importer dans la bibliothèque au
// chargement. Le projet devient ainsi auto-suffisant, sans dépendre de userData.

interface FixtureApi {
  getDefinition?: (id: string) => Promise<any>;
  addCustom?: (def: any) => Promise<any>;
}

function getFixtureApi(): FixtureApi | null {
  const f = (window as any).lightMaestro?.fixtures;
  return f && typeof f === 'object' ? (f as FixtureApi) : null;
}

/** Vrai si l'id référence une fixture personnalisée (non embarquée). */
export function isCustomFixtureId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith('custom-');
}

/**
 * Récupère la définition de CHAQUE fixture patchée (pas seulement les id
 * préfixés « custom- »), pour l'embarquer dans le fichier projet. Une fixture
 * personnalisée peut porter n'importe quel id : l'éditeur produit « custom-… »,
 * mais un import GDTF produit « <manufacturer>-<model> » (ex. « stage-right-… »).
 * Ne filtrer que « custom- » laissait ces définitions dehors et les perdait dès
 * que userData changeait. Ne lève jamais.
 */
export async function collectCustomFixtureDefs(
  patchedFixtures: any[] | undefined
): Promise<any[]> {
  const api = getFixtureApi();
  if (!api?.getDefinition) return [];
  const ids = [...new Set(
    (patchedFixtures || [])
      .map((f: any) => f?.fixtureDefId)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
  )] as string[];
  if (ids.length === 0) return [];
  const defs = await Promise.all(
    ids.map((id) => api.getDefinition!(id).catch(() => null))
  );
  return defs.filter((d): d is any => !!d);
}

/**
 * Ré-importe des définitions custom embarquées dans un fichier projet, afin que
 * getDefinition(id) puisse les résoudre. Ne lève jamais.
 */
export async function importCustomFixtureDefs(defs: any[] | undefined): Promise<void> {
  if (!Array.isArray(defs) || defs.length === 0) return;
  const api = getFixtureApi();
  if (!api?.addCustom) return;
  for (const def of defs) {
    try {
      await api.addCustom(def);
    } catch (e) {
      console.warn('[custom-fixtures] import échoué pour', def?.id, e);
    }
  }
}
