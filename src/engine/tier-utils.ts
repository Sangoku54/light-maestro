/**
 * Tiers de fixtures — source unique de vérité.
 *
 * Historique de bug : `DesignView` groupait les fixtures par tier dans un
 * `useMemo` avec des buckets initialisés en dur ({primary, secondary,
 * tertiary}) alors que l'UI permet de passer une fixture en tier « other »
 * (menu contextuel). `map['other']` était donc `undefined` → crash
 * « Cannot read properties of undefined (reading 'push') » à chaque rendu
 * de la vue dès qu'une fixture avait le tier `other`.
 *
 * `groupByTier` garantit : buckets pré-initialisés pour tous les tiers
 * connus + création à la volée pour toute valeur inattendue (défense en
 * profondeur) — un futur tier ne pourra plus faire crasher le rendu.
 */

export const TIER_KEYS = ['primary', 'secondary', 'tertiary', 'other'] as const;

export type TierKey = (typeof TIER_KEYS)[number];

export interface TieredItem {
  tier?: string | null;
}

export function groupByTier<T extends TieredItem>(items: readonly T[]): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const key of TIER_KEYS) {
    map[key] = [];
  }
  for (const item of items) {
    const key = item.tier || 'primary';
    (map[key] ??= []).push(item);
  }
  return map;
}