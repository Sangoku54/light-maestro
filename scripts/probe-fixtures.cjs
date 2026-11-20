#!/usr/bin/env node
/**
 * Wrapper CLI de l'audit de projet.
 *
 *   node scripts/probe-fixtures.cjs <projet.lmproj> [preset.lmpreset]
 *
 * Delegue le travail a vitest (qui sait resoudre les alias `@electron` et
 * transpiler le TS) via les variables d'environnement LM_PROBE_*.
 * Le code de sortie est celui de vitest : 1 si une anomalie est detectee.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('-'));

if (args.length === 0) {
  // Sans argument : on audite le projet de reference (regression CI).
  const fallback = path.join(process.cwd(), 'LM', 'Yolo.lmproj');
  if (!fs.existsSync(fallback)) {
    console.error(
      'Usage : npm run probe -- <projet.lmproj> [preset.lmpreset]\n' +
      `        (projet de reference introuvable : ${fallback})`,
    );
    process.exit(2);
  }
  args.push(fallback);
}

const project = path.resolve(args[0]);
const preset = args[1] ? path.resolve(args[1]) : undefined;

// Le test vitest est en `skipIf(!exists)` : sans ce controle, un mauvais
// chemin donnerait un « succes » trompeur (0 tests, exit 0).
if (!fs.existsSync(project)) {
  console.error(`Projet introuvable : ${project}`);
  process.exit(2);
}
if (preset && !fs.existsSync(preset)) {
  console.error(`Preset introuvable : ${preset}`);
  process.exit(2);
}

const env = { ...process.env, LM_PROBE_PROJECT: project };
if (preset) env.LM_PROBE_PRESET = preset;

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const res = spawnSync(
  npx,
  ['vitest', 'run', 'src/__tests__/fixture-project-probe.test.ts', '--reporter=verbose', ...flags],
  { stdio: 'inherit', env, shell: process.platform === 'win32' },
);

process.exit(res.status ?? 1);
