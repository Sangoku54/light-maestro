/**
 * VcPlaybackHost — hôte UNIQUE du lecteur de preset (Virtual Console).
 *
 * Avant, chaque tuile « Play Preset » montait son propre `<SongPresetPlayer>`
 * : le lecteur n'existait que si la tuile était visible (page VC active).
 * La lecture était donc impossible à déclencher à distance (Remote LAN) ou
 * par MIDI quand la console n'était pas à l'écran.
 *
 * Maintenant l'état de lecture vit dans `vc-playback-runtime.ts` ; cet hôte,
 * monté UNE seule fois au plus haut de l'application, se contente de rendre
 * le preset en cours. Il fonctionne donc même si l'utilisateur est sur un
 * autre onglet — condition nécessaire pour que le téléphone soit une vraie
 * télécommande.
 */

import React, { useEffect, useState } from 'react';
import { SongPresetPlayer } from './SongPresetPlayer';
import {
  vcPlaybackGetSongPreset,
  vcPlaybackSubscribeSong,
  vcPlaybackSongEnded,
} from '../engine/vc-playback-runtime';

export const VcPlaybackHost: React.FC = () => {
  const [preset, setPreset] = useState(() => vcPlaybackGetSongPreset());

  useEffect(() => {
    // Souscription + resynchronisation immédiate (le preset a pu démarrer
    // avant le montage de l'hôte).
    const un = vcPlaybackSubscribeSong(setPreset);
    setPreset(vcPlaybackGetSongPreset());
    return un;
  }, []);

  if (!preset) return null;
  return <SongPresetPlayer preset={preset} onEnded={() => vcPlaybackSongEnded()} />;
};
