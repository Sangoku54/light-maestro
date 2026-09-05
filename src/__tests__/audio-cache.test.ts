import { describe, it, expect } from 'vitest';
import { normalizeAudioUrl } from '../utils/audio-cache';

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