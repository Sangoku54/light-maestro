/**
 * Visibilité des poutres structurelles (truss) selon le type de scène.
 *
 * Régression corrigée : les beams sont recréés par le rebuild de la scène 3D
 * (changement de stageDims ou des plateaux) avec `visible = true` en dur.
 * L'effet de synchronisation ne réagit qu'aux changements de `stageScene` —
 * qui n'a pas changé lors d'un rebuild — donc les ponts avant/arrière
 * « réapparaissaient » sans avoir été demandés. La visibilité est désormais
 * appliquée À LA CRÉATION des beams et re-synchronisée après chaque rebuild.
 */

export interface TrussBeams {
  back: { visible: boolean } | null;
  front: { visible: boolean } | null;
  left: { visible: boolean } | null;
  right: { visible: boolean } | null;
  poles: Array<{ visible: boolean; userData?: { corner?: string } | null }>;
}

/** Applique la visibilité des poutres selon le type de scène (logique unique). */
export function applyTrussVisibility(tr: TrussBeams, stageScene: string): void {
  const isEmpty = stageScene === 'empty';
  if (tr.back) tr.back.visible = !isEmpty;
  if (tr.front) tr.front.visible = !isEmpty && (stageScene === 'rear-front' || stageScene === 'full');
  if (tr.left) tr.left.visible = !isEmpty && stageScene === 'full';
  if (tr.right) tr.right.visible = !isEmpty && stageScene === 'full';
  for (const pole of tr.poles) {
    const corner: string = pole.userData?.corner || '';
    if (isEmpty) pole.visible = false;
    else if (corner.includes('back')) pole.visible = true;
    else pole.visible = stageScene !== 'rear';
  }
}
