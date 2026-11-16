// ─── Validation des redirections de téléchargement (OFL updater) ──────────
//
// Un header `Location` non validé faisait lever `https.get()` de façon
// SYNCHRONE dans le callback de réponse HTTP → `uncaughtException` →
// blackout + `app.quit()` : l'app se fermait au lancement quand un proxy
// renvoyait une redirection relative ou en http://.

import { describe, it, expect } from 'vitest';
import { isAllowedDownloadUrl } from '@electron/fixtures/updater';

const BASE = 'https://github.com/OpenLightingProject/open-fixture-library/archive/refs/heads/master.zip';

describe('isAllowedDownloadUrl — redirections OFL', () => {
  it('accepte la redirection GitHub absolue (cas nominal)', () => {
    expect(isAllowedDownloadUrl('https://codeload.github.com/OpenLightingProject/open-fixture-library/zip/master', BASE)).toBe(true);
  });

  it('accepte un Location relatif réécrit par rapport à l’URL de base', () => {
    expect(isAllowedDownloadUrl('/OpenLightingProject/open-fixture-library/zip/master', BASE)).toBe(true);
  });

  it('accepte un sous-domaine githubusercontent', () => {
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/x.zip', BASE)).toBe(true);
  });

  it('REFUSE une URL en http:// (le download doit rester en TLS)', () => {
    expect(isAllowedDownloadUrl('http://codeload.github.com/x.zip', BASE)).toBe(false);
  });

  it('REFUSE un Location protocol-relative (//hôte) non-github', () => {
    expect(isAllowedDownloadUrl('//evil.example.com/x.zip', BASE)).toBe(false);
  });

  it('REFUSE un hôte non autorisé', () => {
    expect(isAllowedDownloadUrl('https://evil.example.com/x.zip', BASE)).toBe(false);
  });

  it('REFUSE un hôte qui se fait passer pour github', () => {
    expect(isAllowedDownloadUrl('https://github.com.evil.example/x.zip', BASE)).toBe(false);
    expect(isAllowedDownloadUrl('https://notgithub.com/x.zip', BASE)).toBe(false);
  });

  it('accepte une référence relative qui reste sur github.com', () => {
    // "::::" est une référence relative PARSABLE : elle se résout sur
    // github.com → autorisée (le download reste chez GitHub).
    expect(isAllowedDownloadUrl('::::', BASE)).toBe(true);
  });

  it('REFUSE une chaîne non-parsable', () => {
    expect(isAllowedDownloadUrl('https://[', BASE)).toBe(false);
  });
});
