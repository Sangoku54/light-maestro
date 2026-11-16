// ─── Résolution des canaux pour l'édition groupée de fixtures ──────────────
//
// Quand plusieurs fixtures identiques sont sélectionnées dans
// Configuration > Scènes, on ne propose que les canaux qui existent à la
// MÊME position ET avec le MÊME type dans toutes les fixtures du groupe.
// C'est un fail-safe : on ne propose jamais une commande qui n'existerait
// pas sur toutes les fixtures (sinon on enverrait une valeur sur le canal
// d'une autre fonction — ex. un Gobo écrit sur un Pan).
//
// Les canaux sont indexés par POSITION dans le mode (et non par `index`,
// qui vaut `offset ?? position` — deux numérotations différentes).

/** Canal analysé (forme structurelle compatible avec `AnalyzedChannel`). */
export interface AnalyzedChannelLike {
  index: number;
  name: string;
  type: string;
  dmxAddress: number;
  defaultValue?: number;
}

/** Fixture analysée (forme structurelle compatible avec `AnalyzedFixtureChannels`). */
export interface AnalyzedFixtureLike {
  channels: AnalyzedChannelLike[];
}

/** Canal résolu pour un groupe de fixtures. */
export interface GroupChannel {
  /** Position du canal dans le mode (index de tableau). */
  pos: number;
  name: string;
  type: string;
  defaultValue?: number;
  /**
   * Adresses DMX absolues — une par fixture du groupe, dans l'ordre du
   * groupe. Vide si le canal n'est pas commun à toutes les fixtures.
   */
  addresses: number[];
  /** Vrai si le canal existe à cette position avec le même type partout. */
  common: boolean;
}

/**
 * Résout les canaux d'un groupe de fixtures.
 *
 * @param analyses  Une analyse par fixture du groupe (une seule entrée =
 *                  édition simple). Les entrées sans canaux sont ignorées.
 * @return Un entrée par position de canal, triée par position.
 */
export function resolveGroupChannels(analyses: AnalyzedFixtureLike[]): GroupChannel[] {
  if (!analyses || analyses.length === 0) return [];

  // Nombre de canaux = maximum du groupe (une fixture plus longue ne doit
  // pas tronquer les canaux des autres, elle les rend juste non communs).
  const maxLen = analyses.reduce((m, a) => Math.max(m, a.channels?.length ?? 0), 0);
  const out: GroupChannel[] = [];

  for (let pos = 0; pos < maxLen; pos++) {
    const primary = analyses.find((a) => a.channels?.[pos]);
    const ref = primary?.channels[pos];
    if (!ref) continue;

    // Un canal est commun si TOUTES les fixtures l'ont à cette position avec
    // exactement le même type.
    let common = true;
    const addresses: number[] = [];
    for (const a of analyses) {
      const c = a.channels?.[pos];
      if (!c || c.type !== ref.type) { common = false; break; }
      addresses.push(c.dmxAddress);
    }

    out.push({
      pos,
      name: ref.name,
      type: ref.type,
      defaultValue: ref.defaultValue,
      addresses: common ? addresses : [],
      common,
    });
  }

  return out;
}

/**
 * Identité d'une fixture pour l'édition groupée : deux fixtures ne sont
 * « identiques » que si même fabricant, même modèle ET même mode.
 */
export function fixtureIdentity(f: {
  manufacturer: string;
  model: string;
  modeName: string;
}): string {
  return `${f.manufacturer} ${f.model} · ${f.modeName}`;
}

/**
 * Vrai si toutes les fixtures du groupe partagent la même identité.
 * Sinon, l'édition groupée ne peut proposer que les canaux strictement
 * identiques (même position + même type).
 */
export function isHomogeneousGroup(fixtures: Array<{
  manufacturer: string;
  model: string;
  modeName: string;
}>): boolean {
  if (fixtures.length <= 1) return true;
  const first = fixtureIdentity(fixtures[0]);
  return fixtures.every((f) => fixtureIdentity(f) === first);
}
