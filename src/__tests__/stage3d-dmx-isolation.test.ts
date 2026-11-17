/**
 * Vue 3D — isolation de l'état DMX global (garde-fou de non-régression).
 *
 * Bug passé inaperçu : au montage, Stage3D faisait `dmxBridge.clearAll()`
 * (libérait TOUTES les sources DMX) puis tentait de vider le miroir appStore
 * avec `setUniverseData(i, {})` — un NO-OP, car setUniverseData FUSIONNE au
 * lieu de remplacer. Conséquences :
 *   - ouvrir/fermer la 3D pendant un show coupait la sortie DMX (noir scène,
 *     scintillement) ;
 *   - le miroir gardait des valeurs périmées → la 3D affichait des fixtures
 *     allumées alors que rien n'était playing ;
 *   - une 2e instance de Stage3D (modale 2D) effaçait l'état "Allumer" de la
 *     vue principale.
 *
 * La vue 3D est un LECTEUR : elle ne doit jamais détruire l'état DMX global.
 * Ce test verrouille cette invariant au niveau source (le composant 3D
 * nécessite WebGL, impossible à monter en jsdom).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(process.cwd(), 'src', 'views', 'Stage3D.tsx');

/** Retire les commentaires pour ne cibler que le code exécutable. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s*\/\/.*$/gm, '');
}

describe('Stage3D — la vue 3D ne détruit pas l\'état DMX global', () => {
  it('n\'appelle jamais dmxBridge.clearAll()', () => {
    const code = codeOnly(fs.readFileSync(SRC, 'utf-8'));
    expect(code).not.toContain('dmxBridge.clearAll(');
  });

  it('n\'écrit pas dans le miroir DMX de l\'appStore (setUniverseData)', () => {
    const code = codeOnly(fs.readFileSync(SRC, 'utf-8'));
    expect(code).not.toContain('setUniverseData(');
  });

  it('ne pousse pas le programmeur au montage (double écriture LTP)', () => {
    const code = codeOnly(fs.readFileSync(SRC, 'utf-8'));
    // Le re-push du programmeur est fait par useProgrammerSync (DesignView).
    expect(code).not.toContain("'programmer'");
  });

  it('garde le panneau fixtures rétracté par défaut', () => {
    const code = codeOnly(fs.readFileSync(SRC, 'utf-8'));
    expect(code).toContain('const [leftDockCollapsed, setLeftDockCollapsed] = useState(true);');
  });
});
