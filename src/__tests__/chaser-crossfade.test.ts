import { describe, expect, it } from 'vitest';
import { crossfadeSceneChannels, holdMissingChannels } from '../hooks/dmx-playback';

describe('crossfadeSceneChannels — transitions sans snap', () => {
  it('interpole les canaux communs (k=0 → from, k=1 → to)', () => {
    const out = crossfadeSceneChannels({ 1: 0, 2: 100 }, { 1: 200, 2: 100 }, 0.5);
    expect(out[1]).toBe(100);
    expect(out[2]).toBe(100);
    expect(crossfadeSceneChannels({ 1: 0 }, { 1: 200 }, 0)[1]).toBe(0);
    expect(crossfadeSceneChannels({ 1: 0 }, { 1: 200 }, 1)[1]).toBe(200);
  });

  it('ne fait jamais plonger un canal absent : tient la dernière valeur', () => {
    // Cas tuto.lmproj : Position 2 ne contient pas les fixtures 6/7.
    // Sans hold, elles tomberaient à 0 puis snapperaient au retour.
    const out = crossfadeSceneChannels({ 10: 200 }, {}, 0.5, 1, { 10: 200 });
    expect(out[10]).toBe(200);
    const out2 = crossfadeSceneChannels({}, { 10: 200 }, 0.5, 1, { 10: 200 });
    expect(out2[10]).toBe(200);
  });

  it("sans mémoire, un canal nouveau part de l'autre côté (pas de 0 imposé sauf vrai 0)", () => {
    const out = crossfadeSceneChannels({}, { 10: 200 }, 0.5);
    expect(out[10]).toBe(200);
  });

  it('applique intensity en sortie', () => {
    expect(crossfadeSceneChannels({ 1: 200 }, { 1: 200 }, 0.5, 0.5)[1]).toBe(100);
  });
});

describe('holdMissingChannels — ne lâche aucun canal connu', () => {
  it('complète avec les valeurs tenues sans muter', () => {
    const cur = { 1: 10 };
    const out = holdMissingChannels(cur, { 1: 99, 2: 50 });
    expect(out).toEqual({ 1: 10, 2: 50 });
    expect(cur).toEqual({ 1: 10 });
  });

  it('sans mémoire, retourne une copie conforme', () => {
    expect(holdMissingChannels({ 1: 10 })).toEqual({ 1: 10 });
  });
});
