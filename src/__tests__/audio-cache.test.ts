import { describe, it, expect } from 'vitest';
import { normalizeAudioUrl, pickAudioUrl } from '../utils/audio-cache';

describe('normalizeAudioUrl (lecture audio des presets)', () => {
  it('laisse les data URLs complets intacts (format actuel des .lmproj)', () => {
    expect(normalizeAudioUrl('data:audio/mpeg;base64,UklGRra2ZQ==')).toBe('data:audio/mpeg;base64,UklGRra2ZQ==');
    expect(normalizeAudioUrl('data:audio/wav;base64,UklGRhTSlg==')).toBe('data:audio/wav;base64,UklGRhTSlg==');
  });

  it('préfixe le base64 nu legacy (audioDataBase64 des vieux .lmpreset)', () => {
    expect(normalizeAudioUrl('UklGRra2ZQJXQVZFZm10IBAAAA')).toBe('data:audio/mpeg;base64,UklGRra2ZQJXQVZFZm10IBAAAA');
  });

  it('laisse les vraies URLs (http/blob/file) intactes', () => {
    expect(normalizeAudioUrl('https://cdn.example.com/song.mp3')).toBe('https://cdn.example.com/song.mp3');
    expect(normalizeAudioUrl('blob:file:///abc-123')).toBe('blob:file:///abc-123');
  });

  it('retourne null pour les valeurs manquantes', () => {
    expect(normalizeAudioUrl(undefined)).toBeNull();
    expect(normalizeAudioUrl(null)).toBeNull();
    expect(normalizeAudioUrl('')).toBeNull();
  });
});

describe('pickAudioUrl (audio robuste des presets — pas de perte de son)', () => {
  it('priorise l’audio du fichier/preset chargé', () => {
    const file = 'data:audio/mpeg;base64,UklGRa1bWgAA';
    const store = 'data:audio/mpeg;base64,RIFFxxxx';
    expect(pickAudioUrl(file, store)).toBe(file);
  });

  it('retombe sur l’audio en store quand le .lmpreset n’embarque pas l’audio (fichier vide)', () => {
    const store = 'data:audio/mpeg;base64,UklGRmToewNXQVZFZm10IBAAAA';
    expect(pickAudioUrl('', store)).toBe(store);
    expect(pickAudioUrl(undefined, store)).toBe(store);
    expect(pickAudioUrl(null, store)).toBe(store);
  });

  it('normalise l’audio en store quand il est en base64 nu', () => {
    const store = 'UklGRgAAAAJXQVZFZm10IBAAAA';
    expect(pickAudioUrl(undefined, store)).toBe(`data:audio/mpeg;base64,${store}`);
  });

  it('retourne null quand aucune source audio n’est disponible', () => {
    expect(pickAudioUrl(undefined, undefined)).toBeNull();
    expect(pickAudioUrl('', '')).toBeNull();
    expect(pickAudioUrl('', null)).toBeNull();
  });
});