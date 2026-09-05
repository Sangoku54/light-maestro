// ─── Autoloop SoundSwitch 2.9 — baril d'export (moteur pur) ─────────────────
//
// Point d'entrée unique vers les 4 modules du port TypeScript. Ce fichier ne
// fait QUE ré-exporter : il n'importe AUCUN code React/Electron/`window`, donc
// il reste importable par les tests unitaires (vitest, environnement node).
//
// Pour la glue vers la sortie DMX réelle de Light Maestro, voir
// `autoloop-adapter.ts` (qui, lui, importe `dmxBridge`).

export * from './autoloop-types';
export * from './autoscript-generator';
export * from './autoloop-banks';
export * from './autoloop-engine';
